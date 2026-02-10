import React, { useState, useRef, useCallback } from 'react';
import { translations, Language } from './utils/i18n';
import { Track, EditorState, AiAnalysisResult } from './types';
import { getAudioContext, decodeAudio, mixTracks, bufferToWav } from './utils/audioEditor';
import { analyzeAudioWithGemini } from './utils/geminiClient';
import { parseWavHeader, detectM4aCodec, estimateBitrate, detectBitDepthFromBuffer } from './utils/audioParser';
import { TrackItem } from './components/TrackItem';
import { Play, Pause, Square, Mic, Upload, Download, Sparkles, AlertCircle, Globe, Plus, Cpu, Ruler } from 'lucide-react';

export default function App() {
  const [lang, setLang] = useState<Language>('ja');
  const t = translations[lang];

  // Editor State
  const [tracks, setTracks] = useState<Track[]>([]);
  const [editorState, setEditorState] = useState<EditorState>({
    isPlaying: false,
    currentTime: 0,
    duration: 10,
    zoom: 100,
    verticalScale: 'linear'
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = getAudioContext();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const updateDuration = useCallback((currentTracks: Track[]) => {
    if (currentTracks.length === 0) return;
    const maxDur = Math.max(...currentTracks.map(t => t.buffer.duration));
    setEditorState(prev => ({ ...prev, duration: Math.max(10, maxDur) }));
  }, []);

  // --- Import Logic with Bit Depth & Bitrate Detection ---
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      initAudioContext();
      if (!audioContextRef.current) throw new Error("AudioContext init failed");

      // 1. Detect Bit Depth & Sample Rate from original file before decoding
      const arrayBuffer = await file.arrayBuffer();
      let detectedWavInfo: { bitDepth: number, sampleRate: number } | null = null;
      let m4aInfo: { codec: string, isLossless: boolean } | null = null;
      const lowerName = file.name.toLowerCase();
      
      if (lowerName.endsWith('.wav')) {
        detectedWavInfo = parseWavHeader(arrayBuffer);
      } else if (lowerName.match(/\.(m4a|mp4|aac)$/)) {
        m4aInfo = detectM4aCodec(arrayBuffer);
      }

      // 2. Decode for Web Audio (converts to 32-bit float internal, and resamples to context rate)
      const buffer = await audioContextRef.current.decodeAudioData(arrayBuffer.slice(0));
      
      // 3. Determine Display Labels
      let bitDepthLabel = "Unknown";
      let bitrateLabel = "";
      let displaySampleRate = buffer.sampleRate; // Default to context rate

      // Bitrate Calculation
      if (detectedWavInfo) {
         // Exact for Linear PCM: SampleRate * Channels * Bits
         const kbps = Math.round((detectedWavInfo.sampleRate * buffer.numberOfChannels * detectedWavInfo.bitDepth) / 1000);
         bitrateLabel = `${kbps} kbps`;
         displaySampleRate = detectedWavInfo.sampleRate; // Use original rate from header
      } else {
         // Approx for others: (Size * 8) / Duration
         const kbps = estimateBitrate(file.size, buffer.duration);
         bitrateLabel = `~${kbps} kbps`;
         // For non-WAV, we unfortunately often rely on the decoded buffer rate 
         // unless we parse MP3/AAC frames which is complex without libraries.
      }

      // Bit Depth / Format Label Generation
      if (detectedWavInfo) {
        bitDepthLabel = `${detectedWavInfo.bitDepth}-bit PCM`;
      } else {
        // Fallback: Analyze decoded buffer to estimate bit depth
        const estimatedBits = detectBitDepthFromBuffer(buffer);
        const estString = estimatedBits === 32 ? "32-bit Float" : `${estimatedBits}-bit`;

        if (lowerName.endsWith('.flac')) {
          bitDepthLabel = `FLAC (${estString})`;
        } else if (m4aInfo) {
           // M4A (AAC or ALAC)
           bitDepthLabel = `${m4aInfo.codec} (${estString})`;
        } else if (lowerName.endsWith('.mp3')) {
          bitDepthLabel = `MP3 (${estString})`;
        } else if (lowerName.endsWith('.ogg')) {
          bitDepthLabel = `OGG (${estString})`;
        } else if (lowerName.endsWith('.aiff') || lowerName.endsWith('.aif')) {
          bitDepthLabel = `AIFF (${estString})`;
        } else {
          // Generic fallback
          bitDepthLabel = `${estString} (Est.)`;
        }
      }

      const newTrack: Track = {
        id: crypto.randomUUID(),
        name: file.name,
        file: file,
        buffer: buffer,
        volume: 1.0,
        isMuted: false,
        isSolo: false,
        color: `hsl(${Math.random() * 360}, 70%, 60%)`,
        originalBitDepth: bitDepthLabel,
        originalSampleRate: displaySampleRate,
        bitrate: bitrateLabel
      };

      setTracks(prev => {
        const next = [...prev, newTrack];
        updateDuration(next);
        return next;
      });

    } catch (err) {
      console.error(err);
      setErrorMessage(t.decodeError);
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  const handleRecord = async () => {
    try {
      initAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (!audioContextRef.current) return;
        
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

        // Calculate approx bitrate for recording
        const kbps = estimateBitrate(blob.size, audioBuffer.duration);

        const newTrack: Track = {
          id: crypto.randomUUID(),
          name: "Mic Recording",
          buffer: audioBuffer,
          volume: 1.0,
          isMuted: false,
          isSolo: false,
          color: '#ef4444',
          originalBitDepth: "WebM / 32-bit Float",
          originalSampleRate: audioBuffer.sampleRate, // Recording matches context
          bitrate: `~${kbps} kbps`
        };

        setTracks(prev => {
          const next = [...prev, newTrack];
          updateDuration(next);
          return next;
        });
        setIsProcessing(false);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsProcessing(true); 

    } catch (err) {
      console.error(err);
      setErrorMessage(t.micError);
    }
  };

  const handleStopRecord = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
    }
  };

  const handlePlay = () => {
    if (!audioContextRef.current || tracks.length === 0) return;
    initAudioContext();
    if (editorState.isPlaying) handleStop();

    const ctx = audioContextRef.current;
    const startOffset = editorState.currentTime >= editorState.duration ? 0 : editorState.currentTime;
    const sources: AudioBufferSourceNode[] = [];

    const soloActive = tracks.some(t => t.isSolo);
    const activeTracks = tracks.filter(t => soloActive ? t.isSolo : !t.isMuted);

    activeTracks.forEach(track => {
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = track.volume;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      if (startOffset < track.buffer.duration) {
        source.start(ctx.currentTime, startOffset);
        sources.push(source);
      }
    });

    sourceNodesRef.current = sources;
    startTimeRef.current = ctx.currentTime - startOffset;
    
    setEditorState(prev => ({ ...prev, isPlaying: true }));

    const draw = () => {
      const now = ctx.currentTime;
      const playbackTime = now - startTimeRef.current;
      
      if (playbackTime >= editorState.duration) {
        // Auto-stop and reset to start
        sourceNodesRef.current.forEach(node => {
          try { node.stop(); } catch(e) {}
        });
        sourceNodesRef.current = [];
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        
        setEditorState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
        return;
      }
      
      setEditorState(prev => ({ ...prev, currentTime: playbackTime }));
      animationFrameRef.current = requestAnimationFrame(draw);
    };
    animationFrameRef.current = requestAnimationFrame(draw);
  };

  const handleStop = () => {
    sourceNodesRef.current.forEach(node => {
      try { node.stop(); } catch(e) {}
    });
    sourceNodesRef.current = [];
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setEditorState(prev => ({ ...prev, isPlaying: false }));
  };

  const handleExport = () => {
    if (!audioContextRef.current || tracks.length === 0) return;
    const mixedBuffer = mixTracks(tracks, audioContextRef.current, editorState.duration);
    const blob = bufferToWav(mixedBuffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mixdown_${new Date().toISOString()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAiAction = async (task: 'transcribe' | 'summarize') => {
    if (!audioContextRef.current || tracks.length === 0) return;
    setIsProcessing(true);
    setAiResult(null);

    try {
      const mixedBuffer = mixTracks(tracks, audioContextRef.current, editorState.duration);
      const text = await analyzeAudioWithGemini(mixedBuffer, task, lang);
      setAiResult({
        type: task === 'transcribe' ? 'transcription' : 'summary',
        transcription: task === 'transcribe' ? text : undefined,
        summary: task === 'summarize' ? text : undefined
      });
    } catch (err) {
      console.error(err);
      setErrorMessage("AI Analysis Failed. Check API Key or Audio length.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans">
      
      {/* Top Bar */}
      <header className="bg-gray-900 border-b border-gray-800 p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
              {t.appTitle}
            </h1>
            <button onClick={() => setLang(l => l === 'en' ? 'ja' : 'en')} className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-gray-800">
              <Globe size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2 bg-gray-800 p-2 rounded-xl border border-gray-700">
             <button onClick={() => { handleStop(); setEditorState(p => ({...p, currentTime: 0})); }} className="p-2 hover:bg-gray-700 rounded-lg text-gray-300">
                <Square size={20} fill="currentColor" />
             </button>
             
             {!editorState.isPlaying ? (
               <button onClick={handlePlay} className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-lg">
                 <Play size={24} fill="currentColor" className="ml-1" />
               </button>
             ) : (
               <button onClick={() => handleStop()} className="p-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-full shadow-lg">
                 <Pause size={24} fill="currentColor" />
               </button>
             )}

             <div className="w-px h-8 bg-gray-700 mx-2"></div>

             {mediaRecorderRef.current?.state === 'recording' ? (
                <button onClick={handleStopRecord} className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg animate-pulse">
                   <Square size={16} fill="currentColor" />
                   <span className="text-sm font-bold">REC</span>
                </button>
             ) : (
               <button onClick={handleRecord} className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-red-400 rounded-lg">
                 <Mic size={18} />
                 <span className="text-sm">REC</span>
               </button>
             )}
          </div>

          <div className="font-mono text-xl text-cyan-400 w-32 text-center bg-gray-900 py-1 rounded border border-gray-800">
            {new Date(editorState.currentTime * 1000).toISOString().substr(14, 8)}
          </div>

          <div className="flex gap-2">
            <label className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg cursor-pointer border border-gray-700 transition-colors">
              <Upload size={16} className="text-indigo-400" />
              <span className="text-sm font-medium">{t.import}</span>
              <input type="file" accept="audio/*,.m4a" onChange={handleImport} className="hidden" />
            </label>
            <button onClick={handleExport} disabled={tracks.length === 0} className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 disabled:opacity-50">
              <Download size={16} className="text-emerald-400" />
              <span className="text-sm font-medium">{t.export}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col max-w-7xl mx-auto w-full p-4 gap-6">
        
        {errorMessage && (
          <div className="bg-red-900/30 border border-red-800 text-red-200 p-3 rounded-lg flex items-center gap-2">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-auto text-sm hover:underline">{t.close}</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between bg-gray-900/50 p-3 rounded-xl border border-gray-800">
           <div className="flex items-center gap-4">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider px-2">{t.tracks} ({tracks.length})</span>
              
              {/* Vertical Scale Toggle */}
              <button 
                onClick={() => setEditorState(s => ({ ...s, verticalScale: s.verticalScale === 'linear' ? 'db' : 'linear' }))}
                className="flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 hover:bg-gray-700"
                title={t.dbTooltip}
              >
                <Ruler size={14} />
                {editorState.verticalScale === 'linear' ? t.scaleLinear : t.scaleDb}
              </button>
           </div>

           <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mr-2">{t.geminiAction}</span>
              <button onClick={() => handleAiAction('transcribe')} disabled={tracks.length === 0 || isProcessing} className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg disabled:opacity-50 transition-all">
                {isProcessing ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles size={14} />}
                <span className="text-sm font-medium">{t.transcribe}</span>
              </button>
              <button onClick={() => handleAiAction('summarize')} disabled={tracks.length === 0 || isProcessing} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-indigo-300 border border-indigo-900/50 rounded-lg disabled:opacity-50 transition-colors">
                <span className="text-sm font-medium">{t.summarize}</span>
              </button>
           </div>
        </div>

        {/* Tracks Area */}
        <div className="flex-1 bg-gray-900/30 rounded-2xl border border-gray-800/50 p-4 min-h-[400px] overflow-y-auto relative scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
          {tracks.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 gap-4">
               <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center">
                 <Plus size={32} className="text-gray-600" />
               </div>
               <p>{t.noTracks}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {tracks.map(track => (
                <TrackItem 
                  key={track.id} 
                  track={track} 
                  duration={editorState.duration}
                  verticalScale={editorState.verticalScale}
                  onUpdate={(id, u) => setTracks(p => p.map(t => t.id === id ? {...t, ...u} : t))}
                  onDelete={(id) => {
                     setTracks(prev => {
                       const next = prev.filter(t => t.id !== id);
                       if(next.length===0) setEditorState(s=>({...s, isPlaying:false, currentTime:0}));
                       else updateDuration(next);
                       return next;
                     })
                  }}
                />
              ))}
            </div>
          )}
          
          {/* Playhead */}
          {tracks.length > 0 && (
            <div 
               className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none mix-blend-screen shadow-[0_0_4px_rgba(239,68,68,0.8)]"
               style={{ 
                 // Simple positioning calc: 1rem (padding) + 14rem (controls) + 2.5rem (ruler) + time ratio
                 // Controls width: w-56 (14rem) = 224px. Ruler w-10 = 40px. Padding 16px. Border 1px.
                 // Total offset approx 282px.
                 left: `calc(16px + 224px + 1px + 40px + 1px + ${(editorState.currentTime / editorState.duration) * 1000}px)` 
               }} 
            />
          )}
        </div>

        {/* AI Results */}
        {aiResult && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 animate-in slide-in-from-bottom-4 duration-300 shadow-2xl">
             <div className="flex items-center justify-between mb-4 border-b border-gray-800 pb-2">
               <h3 className="text-lg font-bold text-white flex items-center gap-2">
                 <Sparkles className="text-indigo-400" size={20} />
                 {t.aiResult}
               </h3>
               <button onClick={() => setAiResult(null)} className="text-gray-500 hover:text-white">{t.close}</button>
             </div>
             <div className="prose prose-invert max-w-none max-h-64 overflow-y-auto">
                {aiResult.type === 'transcription' ? (
                  <p className="whitespace-pre-wrap text-gray-300 leading-relaxed">{aiResult.transcription}</p>
                ) : (
                  <div className="text-gray-300 whitespace-pre-wrap">{aiResult.summary}</div>
                )}
             </div>
          </div>
        )}
      </main>

      {/* Status Bar */}
      <footer className="bg-gray-950 border-t border-gray-800 py-2 px-4 text-xs text-gray-500 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Cpu size={12} />
          <span>{t.internalFormat}</span>
        </div>
        <div>v1.0.0 (Client-Side)</div>
      </footer>
    </div>
  );
}