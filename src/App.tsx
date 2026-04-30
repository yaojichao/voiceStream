/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, RotateCcw, Copy, Check, Info, Settings, History, Volume2, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface TranscriptItem {
  id: string;
  text: string;
  timestamp: number;
  confidence: number;
}

// Support for WebKit browsers (Safari/Chrome)
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [history, setHistory] = useState<TranscriptItem[]>([]);
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'live' | 'history' | 'verify'>('live');
  const [targetText, setTargetText] = useState('');
  const [similarity, setSimilarity] = useState(0);

  // Simple string similarity (Levenshtein based)
  const calculateSimilarity = (s1: string, s2: string) => {
    if (!s1 || !s2) return 0;
    const len1 = s1.length;
    const len2 = s2.length;
    const matrix = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    return 1 - distance / maxLength;
  };

  useEffect(() => {
    if (viewMode === 'verify' && targetText && transcript) {
      setSimilarity(calculateSimilarity(targetText.trim(), transcript.trim()));
    }
  }, [targetText, transcript, viewMode]);

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (!SpeechRecognition) {
      setError('Your browser does not support Speech Recognition. Please use Chrome or Safari.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN'; // Default to Chinese as requested

    recognition.onresult = (event: any) => {
      let currentInterim = '';
      let currentFinal = '';
      let currentConfidence = 0;

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinal += event.results[i][0].transcript;
          currentConfidence = event.results[i][0].confidence;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }

      if (currentFinal) {
        setTranscript(prev => prev + currentFinal + ' ');
        setConfidence(currentConfidence);
      }
      setInterimTranscript(currentInterim);
    };

    recognition.onerror = (event: any) => {
      console.error('Recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Please enable it in browser settings.');
      } else {
        setError(`Error: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      if (isRecording) {
        recognition.start(); // Keep recording if we haven't manually stopped
      }
    };

    recognitionRef.current = recognition;
  }, [isRecording]);

  // Audio Visualization Logic
  const startVisualizer = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      analyserRef.current.fftSize = 256;
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        if (!canvasRef.current || !analyserRef.current) return;
        animationFrameRef.current = requestAnimationFrame(draw);

        analyserRef.current.getByteFrequencyData(dataArray);

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          barHeight = (dataArray[i] / 255) * height;

          // Technical green gradient
          const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
          gradient.addColorStop(0, '#00FF41');
          gradient.addColorStop(1, '#008F11');

          ctx.fillStyle = gradient;
          ctx.fillRect(x, height - barHeight, barWidth, barHeight);

          x += barWidth + 1;
        }
      };

      draw();
    } catch (err) {
      console.error('Visualizer error:', err);
    }
  }, []);

  const stopVisualizer = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
  }, []);

  // Handlers
  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      stopVisualizer();
      
      // Save to history on stop if there's content
      if (transcript.trim()) {
        setHistory(prev => [{
          id: crypto.randomUUID(),
          text: transcript.trim(),
          timestamp: Date.now(),
          confidence
        }, ...prev]);
      }
    } else {
      setError(null);
      setTranscript('');
      setInterimTranscript('');
      recognitionRef.current?.start();
      startVisualizer();
    }
    setIsRecording(!isRecording);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(transcript);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const resetTranscript = () => {
    setTranscript('');
    setInterimTranscript('');
    setConfidence(0);
  };

  return (
    <div className="min-h-screen bg-[#E6E6E6] p-4 md:p-8 font-sans selection:bg-[#FF4444]/20">
      {/* Console Frame */}
      <div className="max-w-6xl mx-auto bg-[#151619] rounded-[2rem] shadow-[0_40px_100px_rgba(0,0,0,0.4),inset_0_-4px_10px_rgba(255,255,255,0.05),inset_0_4px_10px_rgba(0,0,0,0.5)] border-t border-white/5 border-x border-white/5 overflow-hidden flex flex-col h-[90vh]">
        
        {/* Top Control Bar (The "Rail") */}
        <header className="h-16 border-b border-black/40 bg-[#1a1c1e] px-8 flex items-center justify-between shadow-lg relative z-20">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-[#222] border border-white/10 flex items-center justify-center">
                <Volume2 className="w-4 h-4 text-[#8E9299]" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-xs font-mono font-bold text-white tracking-[0.2em] uppercase">Vocal_Processor_X1</h1>
                <p className="text-[9px] font-mono text-[#8E9299] uppercase tracking-widest opacity-50">STT Accuracy Validator // Unit-04</p>
              </div>
            </div>
          </div>

          <div className="flex bg-black/40 p-1 rounded-full border border-white/5">
            {[
              { id: 'live', label: 'MONITOR' },
              { id: 'verify', label: 'VERIFY' },
              { id: 'history', label: 'LOGS' }
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => setViewMode(mode.id as any)}
                className={`px-5 py-1.5 rounded-full text-[10px] font-mono tracking-widest transition-all ${
                  viewMode === mode.id 
                    ? 'bg-[#8E9299] text-black font-bold' 
                    : 'text-[#8E9299] hover:text-white'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4 text-[#8E9299]">
            <div className="flex gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-[#FF4444] animate-pulse' : 'bg-white/10'}`} />
              <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-[#FF4444]/60' : 'bg-white/10'}`} />
            </div>
            <Settings className="w-4 h-4 hover:text-white cursor-pointer" />
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          
          {/* Main Display Screen (Centered/Left) */}
          <section className="flex-1 bg-[#0a0a0c] p-6 lg:p-12 relative flex flex-col shadow-[inset_0_0_100px_rgba(0,0,0,0.8)]">
            {/* Screen Overlay Pattern */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#fff_1px,transparent_0)] bg-[size:16px_16px]" />
            
            <div className="relative z-10 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-8 opacity-40">
                <div className="flex gap-2">
                  <span className="text-[10px] font-mono text-[#8E9299]">CH.1: INPUT_SRC</span>
                  <span className="text-[10px] font-mono text-white">LOCKED</span>
                </div>
                <div className="text-[10px] font-mono text-[#8E9299]">REF_0x299A</div>
              </div>

              <div className="flex-1 flex flex-col justify-center max-w-3xl mx-auto w-full">
                {viewMode === 'live' && (
                  <div className="space-y-6">
                    <div className="min-h-[120px] font-mono text-4xl lg:text-5xl text-white leading-tight tracking-tighter italic">
                      <AnimatePresence mode="popLayout">
                        {transcript || interimTranscript ? (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <span>{transcript}</span>
                            <span className="text-[#FF4444]">{interimTranscript}</span>
                            {isRecording && <span className="inline-block w-1 h-10 bg-[#FF4444] animate-pulse ml-2 align-bottom" />}
                          </motion.div>
                        ) : (
                          <div className="opacity-20 flex flex-col items-center gap-4 py-20">
                            <Mic className="w-16 h-16" />
                            <p className="text-sm tracking-[0.4em] uppercase text-center">Awaiting Audio Input Signal</p>
                          </div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {viewMode === 'verify' && (
                  <div className="space-y-8">
                    <div className="bg-white/[0.03] rounded-2xl border border-white/5 p-6 backdrop-blur-sm">
                      <label className="block text-[10px] font-mono text-[#8E9299] uppercase tracking-widest mb-4">Target Script</label>
                      <textarea
                        value={targetText}
                        onChange={(e) => setTargetText(e.target.value)}
                        placeholder="Define sequence to match..."
                        className="w-full h-32 bg-transparent text-xl font-mono text-[#8E9299] focus:text-white transition-colors resize-none focus:outline-none"
                      />
                    </div>
                    <div className="min-h-[100px] font-mono text-3xl text-white italic">
                      {transcript || interimTranscript ? (
                        <>
                          <span className="opacity-100">{transcript}</span>
                          <span className="text-[#FF4444]">{interimTranscript}</span>
                        </>
                      ) : (
                        <p className="text-sm text-[#8E9299] uppercase tracking-[0.2em]">Capture will stream here...</p>
                      )}
                    </div>
                  </div>
                )}

                {viewMode === 'history' && (
                  <div className="space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar pr-4">
                    {history.length > 0 ? (
                      history.map((item) => (
                        <div key={item.id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl group hover:bg-white/[0.05] transition-all">
                          <div className="flex justify-between items-center mb-4">
                            <span className="text-[9px] font-mono text-[#8E9299] opacity-50 uppercase">CAPTURE ID: {item.id.slice(0, 8)}</span>
                            <span className="text-[9px] font-mono text-[#8E9299]">{new Date(item.timestamp).toLocaleString()}</span>
                          </div>
                          <p className="text-xl font-mono text-[#8E9299] group-hover:text-white transition-colors">"{item.text}"</p>
                        </div>
                      ))
                    ) : (
                      <div className="py-20 text-center opacity-20 uppercase tracking-widest text-sm font-mono">Archive Empty</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Corner Labels (Physics Console Aesthetics) */}
            <div className="absolute bottom-6 left-6 text-[8px] font-mono text-[#8E9299] opacity-30 select-none">
              TERMINAL_PROC_V4_SEC_A
            </div>
            <div className="absolute bottom-6 right-6 text-[8px] font-mono text-[#8E9299] opacity-30 select-none">
              ISO_9001_COMPLIANT
            </div>
          </section>

          {/* Side Control Panel (Hardware Controls) */}
          <aside className="w-full md:w-80 bg-[#1a1c1e] border-l border-black/40 flex flex-col p-8 space-y-8 relative z-10">
            {/* Master Record Trigger */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <span className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">Master Trigger</span>
                <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-[#FF4444] shadow-[0_0_8px_#FF4444]' : 'bg-white/10'}`} />
              </div>
              
              <button 
                onClick={toggleRecording}
                className={`w-full aspect-square rounded-full border-[12px] flex items-center justify-center transition-all duration-300 relative group overflow-hidden ${
                  isRecording 
                    ? 'bg-[#FF4444] border-black/40 shadow-[0_0_50px_rgba(255,68,68,0.3)]' 
                    : 'bg-[#2a2c30] border-black/40 shadow-[0_4px_10px_rgba(0,0,0,0.5)]'
                }`}
              >
                <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none" />
                {isRecording ? (
                  <MicOff className="w-12 h-12 text-white drop-shadow-lg" />
                ) : (
                  <Mic className="w-12 h-12 text-[#8E9299] group-hover:text-white transition-colors" />
                )}
              </button>
              
              <div className="text-center font-mono py-2">
                <p className={`text-xs uppercase tracking-widest font-bold ${isRecording ? 'text-[#FF4444]' : 'text-white/40'}`}>
                  {isRecording ? 'System recording' : 'Standby mode'}
                </p>
              </div>
            </div>

            {/* Signal Visualizer (Hardware Style) */}
            <div className="space-y-3">
              <span className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest block px-2">Analog Monitor</span>
              <div className="h-32 bg-black/40 rounded-xl border border-white/5 overflow-hidden flex items-end p-2 gap-0.5">
                <canvas ref={canvasRef} width={200} height={100} className="w-full h-full opacity-60" />
              </div>
            </div>

            {/* Utility Dials / Metrics */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                <span className="text-[8px] font-mono text-[#8E9299] uppercase block mb-1">Gain / Confidence</span>
                <div className="text-sm font-mono text-white">{(confidence * 100).toFixed(0)}%</div>
                <div className="h-1 bg-white/5 rounded-full mt-2 overflow-hidden">
                  <motion.div animate={{ width: `${confidence * 100}%` }} className="h-full bg-[#8E9299]" />
                </div>
              </div>
              <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                <span className="text-[8px] font-mono text-[#8E9299] uppercase block mb-1">Signal Acc</span>
                <div className="text-sm font-mono text-white">{(similarity * 100).toFixed(0)}%</div>
                <div className="h-1 bg-white/5 rounded-full mt-2 overflow-hidden">
                  <motion.div animate={{ width: `${similarity * 100}%` }} className="h-full bg-[#FF4444]" />
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="pt-4 flex gap-2">
              <button 
                onClick={resetTranscript}
                className="flex-1 py-3 bg-black/40 border border-white/10 rounded-lg text-[9px] font-mono text-[#8E9299] uppercase hover:text-white transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
              <button 
                onClick={copyToClipboard}
                className="flex-1 py-3 bg-black/40 border border-white/10 rounded-lg text-[9px] font-mono text-[#8E9299] uppercase hover:text-white transition-all flex items-center justify-center gap-2"
              >
                {isCopied ? <Check className="w-3 h-3 text-[#FF4444]" /> : <Copy className="w-3 h-3" />}
                {isCopied ? 'OK' : 'Export'}
              </button>
            </div>

            {/* Bottom Tech Label */}
            <div className="mt-auto pt-8 flex items-center gap-2 opacity-20">
              <Activity className="w-4 h-4 text-[#8E9299]" />
              <div className="flex-1 h-px bg-[#8E9299]/30" />
              <span className="text-[8px] font-mono text-[#8E9299] uppercase">Analog/STT-Engine</span>
            </div>
          </aside>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="max-w-6xl mx-auto mt-8 flex justify-between items-center px-4 opacity-40">
        <div className="text-[10px] font-mono flex items-center gap-6">
          <span>LATENCY: 12ms</span>
          <span>SR: 44.1kHz</span>
          <span>B: 16bit</span>
        </div>
        <div className="text-[10px] font-mono">
          MODEL_Z-9 // VER_CONTROL_S_RUN
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 20px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
}

