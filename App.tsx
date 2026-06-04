import React, { useState, useRef, useCallback, useEffect } from 'react';
import { translations, Language } from './utils/i18n';
import { Track, EditorState, AiAnalysisResult } from './types';
import { getAudioContext, decodeAudio, mixTracks, bufferToWav } from './utils/audioEditor';
import { analyzeAudioWithGemini } from './utils/geminiClient';
import { parseWavHeader, detectM4aCodec, parseM4aHeader, estimateBitrate, detectBitDepthFromBuffer } from './utils/audioParser';
import { TrackItem } from './components/TrackItem';
import { SpectrumAnalyzer } from './components/SpectrumAnalyzer';
import { Play, Pause, Square, Mic, Upload, Download, Sparkles, AlertCircle, Globe, Plus, Cpu, Ruler, ZoomIn, ZoomOut, MoveHorizontal, ChevronDown } from 'lucide-react';

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_AI_DURATION_SEC = 300; // 5 minutes

export default function App() {
  const [lang, setLang] = useState<Language>('ja');
  const t = translations[lang];

  // Editor State
  const [tracks, setTracks] = useState<Track[]>([]);
  const [editorState, setEditorState] = useState<EditorState>({
    isPlaying: false,
    currentTime: 0,
    duration: 10,
    zoom: 50, // pixels per second (initial zoom)
    scrollX: 0, // seconds
    verticalScale: 'linear'
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Export State
  const [exportBitDepth, setExportBitDepth] = useState<16 | 24 | 32>(16);

  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null); // For visualization
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const ctx = getAudioContext();
      audioContextRef.current = ctx;
      
      // Setup Analyser
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
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

  // --- Zoom & Scroll Handlers ---
  const handleZoom = (direction: 'in' | 'out') => {
    setEditorState(prev => {
      const newZoom = direction === 'in' ? prev.zoom * 1.2 : prev.zoom / 1.2;
      return { ...prev, zoom: Math.max(10, Math.min(newZoom, 1000)) };
    });
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      handleZoom(e.deltaY < 0 ? 'in' : 'out');
    } else {
      // Horizontal scroll with wheel
      // e.deltaY is usually vertical scroll, mapping it to horizontal time scroll
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        setEditorState(prev => {
          const deltaSeconds = e.deltaY / prev.zoom;
          const newScroll = Math.max(0, Math.min(prev.scrollX + deltaSeconds, prev.duration));
          return { ...prev, scrollX: newScroll };
        });
      }
    }
  }, []);

  // Attach wheel listener to tracks container
  useEffect(() => {
    const el = tracksContainerRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (el) el.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);


  // --- Import Logic ---
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage('File size exceeds 200MB limit. Please use a smaller file.');
      e.target.value = '';
      return;
    }

    setIsProcessing(true);
    try {
      initAudioContext();
      if (!audioContextRef.current) throw new Error("AudioContext init failed");

      const arrayBuffer = await file.arrayBuffer();
      let detectedWavInfo: { bitDepth: number, sampleRate: number } | null = null;
      let detectedM4aInfo: { sampleRate: number, codec: string } | null = null;
      let m4aCodecInfo: { codec: string, isLossless: boolean } | null = null;
      
      const lowerName = file.name.toLowerCase();
      
      if (lowerName.endsWith('.wav')) {
        detectedWavInfo = parseWavHeader(arrayBuffer);
      } else if (lowerName.match(/\.(m4a|mp4|aac)$/)) {
        try { detectedM4aInfo = parseM4aHeader(arrayBuffer); } catch { /* ignore optional metadata parse errors */ }
        m4aCodecInfo = detectM4aCodec(arrayBuffer);
      }

      const buffer = await audioContextRef.current.decodeAudioData(arrayBuffer.slice(0));
      
      let bitDepthLabel = "Unknown";
      let bitrateLabel = "";
      let displaySampleRate = buffer.sampleRate;

      if (detectedWavInfo) {
         const kbps = Math.round((detectedWavInfo.sampleRate * buffer.numberOfChannels * detectedWavInfo.bitDepth) / 1000);
         bitrateLabel = `${kbps} kbps`;
         displaySampleRate = detectedWavInfo.sampleRate;
      } else {
         const kbps = estimateBitrate(file.size, buffer.duration);
         bitrateLabel = `~${kbps} kbps`;
         if (detectedM4aInfo) displaySampleRate = detectedM4aInfo.sampleRate;
      }

      if (detectedWavInfo) {
        bitDepthLabel = `${detectedWavInfo.bitDepth}-bit PCM`;
      } else {
        const estimatedBits = detectBitDepthFromBuffer(buffer);
        const estString = estimatedBits === 32 ? "32-bit Float" : `${estimatedBits}-bit`;
        if (lowerName.endsWith('.flac')) bitDepthLabel = `FLAC (${estString})`;
        else if (lowerName.match(/\.(m4a|mp4|aac)$/)) {
           const codecName = m4aCodecInfo?.codec || detectedM4aInfo?.codec || "M4A";
           bitDepthLabel = `${codecName} (${estString})`;
        } else if (lowerName.endsWith('.mp3')) bitDepthLabel = `MP3 (${estString})`;
        else bitDepthLabel = `${estString} (Est.)`;
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
          originalSampleRate: audioBuffer.sampleRate,
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

  const handleSeek = (time: number) => {
    setEditorState(prev => ({ ...prev, currentTime: time }));
    if (editorState.isPlaying) {
      handlePlay(time); // Restart from new time
    }
  };

  const handlePlay = (startTimeOverride?: number) => {
    if (!audioContextRef.current || tracks.length === 0) return;
    initAudioContext();
    if (editorState.isPlaying) handleStop(); // Stop existing before starting new

    const ctx = audioContextRef.current;
    const startOffset = startTimeOverride !== undefined ? startTimeOverride : (editorState.currentTime >= editorState.duration ? 0 : editorState.currentTime);
    const sources: AudioBufferSourceNode[] = [];

    const soloActive = tracks.some(t => t.isSolo);
    const activeTracks = tracks.filter(t => soloActive ? t.isSolo : !t.isMuted);

    // Master Gain for visualizer connection
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    if (analyserRef.current) {
      masterGain.connect(analyserRef.current);
    }

    activeTracks.forEach(track => {
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = track.volume;
      source.connect(gainNode);
      gainNode.connect(masterGain);

      if (startOffset < track.buffer.duration) {
        source.start(ctx.currentTime, startOffset);
        sources.push(source);
      }
    });

    sourceNodesRef.current = sources;
    startTimeRef.current = ctx.currentTime - startOffset;
    
    setEditorState(prev => ({ ...prev, isPlaying: true, currentTime: startOffset })); // Ensure state matches

    const draw = () => {
      const now = ctx.currentTime;
      const playbackTime = now - startTimeRef.current;
      
      if (playbackTime >= editorState.duration) {
        handleStop();
        setEditorState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
        return;
      }
      
      setEditorState(prev => {
        // Auto-scroll logic: if playback head hits right edge
        const viewportWidth = tracksContainerRef.current?.clientWidth || 800;
        const visibleDuration = (viewportWidth - 280) / prev.zoom; // 280 approx offset for sidebar
        const relativeTime = playbackTime - prev.scrollX;
        
        let newScroll = prev.scrollX;
        if (relativeTime > visibleDuration * 0.9) {
           newScroll = playbackTime - (visibleDuration * 0.1);
        }

        return { ...prev, currentTime: playbackTime, scrollX: newScroll };
      });
      animationFrameRef.current = requestAnimationFrame(draw);
    };
    animationFrameRef.current = requestAnimationFrame(draw);
  };

  const handleStop = () => {
    sourceNodesRef.current.forEach(node => {
      try { node.stop(); } catch { /* already stopped or not yet started */ }
    });
    sourceNodesRef.current = [];
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setEditorState(prev => ({ ...prev, isPlaying: false }));
  };

  const handleExport = () => {
    if (!audioContextRef.current || tracks.length === 0) return;
    const mixedBuffer = mixTracks(tracks, audioContextRef.current, editorState.duration);
    
    // Use the selected bit depth
    const blob = bufferToWav(mixedBuffer, exportBitDepth);
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const depthLabel = exportBitDepth === 32 ? '32bit-float' : `${exportBitDepth}bit`;
    a.download = `mixdown_${depthLabel}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.wav`;
    
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAiAction = async (task: 'transcribe' | 'summarize') => {
    if (!audioContextRef.current || tracks.length === 0) return;

    if (editorState.duration > MAX_AI_DURATION_SEC) {
      setErrorMessage('Audio too long for AI analysis. Maximum is 5 minutes (300s).');
      return;
    }

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
      setErrorMessage("AI Analysis Failed. Check API Key or Audio length.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Timeline Ruler Calculation
  const renderTimeRuler = () => {
    const ticks = [];
    // Start from scrollX, go until scrollX + viewport
    const viewportWidth = tracksContainerRef.current?.clientWidth || 1000;
    // Sidebar width is roughly 224px (w-56) + 40px ruler + padding. Let's assume safe width.
    // 16px (padding) + 1px (border) + 224px (sidebar) + 40px (ruler) = 281px
    const effectiveWidth = viewportWidth - 281; 
    
    const startSec = Math.floor(editorState.scrollX);
    const endSec = startSec + (effectiveWidth / editorState.zoom) + 1;

    for (let s = startSec; s < endSec; s++) {
      const left = (s - editorState.scrollX) * editorState.zoom;
      if (left < 0) continue;
      
      ticks.push(
        <div key={s} className="absolute top-0 bottom-0 border-l border-gray-700 select-none pointer-events-none" style={{ left: `${left}px` }}>
           <span className="absolute top-1 left-1 text-[10px] text-gray-500 font-mono">{new Date(s * 1000).toISOString().substr(14, 5)}</span>
        </div>
      );
    }
    return ticks;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans overflow-hidden">
      
      {/* Top Bar */}
      <header className="bg-gray-900 border-b border-gray-800 p-3 sticky top-0 z-50 shadow-md shrink-0">
        <div className="max-w-full mx-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400 tracking-tight">
              AUDIO SPEC PRO
            </h1>
            <button onClick={() => setLang(l => l === 'en' ? 'ja' : 'en')} className="px-2 py-1 text-xs text-gray-500 border border-gray-700 rounded hover:text-white hover:bg-gray-800">
              {lang.toUpperCase()}
            </button>
          </div>

          <div className="flex items-center gap-2 bg-gray-950 p-1.5 rounded-lg border border-gray-800 shadow-inner">
             <button onClick={() => { handleStop(); setEditorState(p => ({...p, currentTime: 0, scrollX: 0})); }} className="p-2 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors">
                <Square size={16} fill="currentColor" />
             </button>
             
             {!editorState.isPlaying ? (
               <button onClick={() => handlePlay()} className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded shadow-lg transition-all hover:scale-105 active:scale-95">
                 <Play size={20} fill="currentColor" className="ml-0.5" />
               </button>
             ) : (
               <button onClick={() => handleStop()} className="p-2.5 bg-yellow-500 hover:bg-yellow-400 text-black rounded shadow-lg transition-all active:scale-95">
                 <Pause size={20} fill="currentColor" />
               </button>
             )}

             <div className="w-px h-6 bg-gray-800 mx-2"></div>

             {mediaRecorderRef.current?.state === 'recording' ? (
                <button onClick={handleStopRecord} className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded animate-pulse">
                   <Square size={14} fill="currentColor" />
                   <span className="text-xs font-bold tracking-wider">REC</span>
                </button>
             ) : (
               <button onClick={handleRecord} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-red-400 rounded transition-colors group">
                 <Mic size={16} className="group-hover:text-red-300" />
                 <span className="text-xs font-bold tracking-wider group-hover:text-red-300">REC</span>
               </button>
             )}
          </div>

          <div className="flex items-center gap-4">
             <div className="font-mono text-xl text-cyan-400 tabular-nums tracking-widest bg-gray-950 px-4 py-1 rounded border border-gray-800 shadow-[0_0_10px_rgba(34,211,238,0.1)]">
               {new Date(editorState.currentTime * 1000).toISOString().substr(14, 9)}
             </div>

             <div className="flex gap-2">
                <label className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded cursor-pointer border border-gray-700 transition-colors">
                  <Upload size={14} className="text-indigo-400" />
                  <span className="text-xs font-bold text-gray-300">{t.import}</span>
                  <input type="file" accept="audio/*,.m4a" onChange={handleImport} className="hidden" />
                </label>
                
                <div className="flex items-center bg-gray-800 rounded border border-gray-700">
                  <div className="relative border-r border-gray-700 h-full">
                     <select 
                       value={exportBitDepth} 
                       onChange={(e) => setExportBitDepth(parseInt(e.target.value) as any)}
                       className="appearance-none bg-transparent text-xs font-mono text-gray-300 pl-2 pr-6 py-1.5 outline-none cursor-pointer hover:bg-gray-700 rounded-l"
                     >
                       <option value={16}>16-bit</option>
                       <option value={24}>24-bit</option>
                       <option value={32}>32-bit (F)</option>
                     </select>
                     <ChevronDown size={10} className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                  </div>
                  <button onClick={handleExport} disabled={tracks.length === 0} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 disabled:opacity-50 transition-colors rounded-r">
                    <Download size={14} className="text-emerald-400" />
                    <span className="text-xs font-bold text-gray-300">{t.export}</span>
                  </button>
                </div>
             </div>
          </div>
        </div>
      </header>

      {/* Visualizer Panel */}
      <SpectrumAnalyzer analyser={analyserRef.current} isPlaying={editorState.isPlaying} />

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col w-full overflow-hidden relative">
        
        {/* Toolbar & HUD */}
        <div className="flex items-center justify-between p-2 bg-gray-900 border-b border-gray-800">
           <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-500 uppercase px-2 border-r border-gray-700">Display</span>
              
              <button 
                onClick={() => setEditorState(s => ({ ...s, verticalScale: s.verticalScale === 'linear' ? 'db' : 'linear' }))}
                className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] text-gray-300 transition-colors"
                title={t.dbTooltip}
              >
                <Ruler size={12} />
                {editorState.verticalScale === 'linear' ? t.scaleLinear : t.scaleDb}
              </button>

              <div className="w-px h-4 bg-gray-700 mx-1"></div>

              <button onClick={() => handleZoom('out')} className="p-1 hover:bg-gray-700 rounded text-gray-400"><ZoomOut size={14} /></button>
              <div className="flex items-center gap-1 px-2 min-w-[60px] justify-center">
                 <span className="text-[10px] text-gray-400">ZOOM</span>
                 <span className="text-[10px] text-cyan-400 font-mono">{Math.round(editorState.zoom)}%</span>
              </div>
              <button onClick={() => handleZoom('in')} className="p-1 hover:bg-gray-700 rounded text-gray-400"><ZoomIn size={14} /></button>
           </div>

           <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-500 uppercase px-2">Gemini AI Tools</span>
              <button onClick={() => handleAiAction('transcribe')} disabled={tracks.length === 0 || isProcessing} className="flex items-center gap-1.5 px-3 py-1 bg-indigo-900/50 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-200 rounded text-xs disabled:opacity-50 transition-all">
                {isProcessing ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles size={12} />}
                <span>{t.transcribe}</span>
              </button>
              <button onClick={() => handleAiAction('summarize')} disabled={tracks.length === 0 || isProcessing} className="flex items-center gap-1.5 px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 rounded text-xs disabled:opacity-50 transition-colors">
                <span>{t.summarize}</span>
              </button>
           </div>
        </div>

        {errorMessage && (
          <div className="absolute top-2 right-2 z-50 bg-red-950/90 border border-red-500/50 text-red-200 px-4 py-2 rounded shadow-xl flex items-center gap-2 backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={16} />
            <span className="text-sm">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-2 font-bold hover:text-white">×</button>
          </div>
        )}

        {/* Tracks Scroll Area */}
        <div ref={tracksContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden relative bg-gray-950 custom-scrollbar">
          
          {/* Time Ruler (Fixed to Background) */}
          <div className="sticky top-0 h-6 bg-gray-900 border-b border-gray-800 z-20 flex items-center shadow-sm">
             <div className="w-[281px] shrink-0 border-r border-gray-800 h-full flex items-center px-2 bg-gray-900 z-30">
                <span className="text-[10px] text-gray-500 font-mono">TIMELINE</span>
             </div>
             <div className="flex-1 relative h-full">
                {renderTimeRuler()}
             </div>
          </div>

          <div className="p-4 space-y-2 pb-32">
            {tracks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-600 gap-4 opacity-50">
                <div className="w-20 h-20 border-2 border-dashed border-gray-700 rounded-2xl flex items-center justify-center">
                  <Plus size={32} />
                </div>
                <p className="font-mono text-sm">{t.noTracks}</p>
              </div>
            )}
            
            {tracks.map(track => (
              <TrackItem 
                key={track.id} 
                track={track} 
                duration={editorState.duration}
                verticalScale={editorState.verticalScale}
                zoom={editorState.zoom}
                scrollX={editorState.scrollX}
                onUpdate={(id, u) => setTracks(p => p.map(t => t.id === id ? {...t, ...u} : t))}
                onDelete={(id) => {
                   setTracks(prev => {
                     const next = prev.filter(t => t.id !== id);
                     if(next.length===0) setEditorState(s=>({...s, isPlaying:false, currentTime:0}));
                     else updateDuration(next);
                     return next;
                   })
                }}
                onSeek={handleSeek}
              />
            ))}
          </div>
          
          {/* Playhead Line */}
          {tracks.length > 0 && (
             <div 
               className="absolute top-6 bottom-0 w-px bg-red-500 z-10 pointer-events-none mix-blend-screen"
               style={{ 
                 // 16px (padding) + 1px (border) + 224px (sidebar) + 40px (ruler) = 281px
                 left: `${281 + (editorState.currentTime - editorState.scrollX) * editorState.zoom}px`,
                 display: (editorState.currentTime < editorState.scrollX) ? 'none' : 'block'
               }} 
             >
                <div className="w-3 h-3 -ml-1.5 bg-red-500 transform rotate-45 -mt-1.5 shadow-[0_0_5px_rgba(239,68,68,1)]"></div>
             </div>
          )}

        </div>

        {/* AI Results Overlay */}
        {aiResult && (
          <div className="absolute bottom-8 right-8 w-96 max-h-[50%] bg-gray-900/95 border border-indigo-500/30 rounded-lg shadow-2xl backdrop-blur-md flex flex-col z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
             <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-indigo-950/20">
               <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
                 <Sparkles size={14} />
                 GEMINI ANALYSIS
               </h3>
               <button onClick={() => setAiResult(null)} className="text-gray-400 hover:text-white">×</button>
             </div>
             <div className="p-4 overflow-y-auto custom-scrollbar text-sm leading-relaxed text-gray-300">
                {aiResult.type === 'transcription' ? (
                  <p className="whitespace-pre-wrap">{aiResult.transcription}</p>
                ) : (
                  <div className="whitespace-pre-wrap">{aiResult.summary}</div>
                )}
             </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-gray-950 border-t border-gray-800 py-1 px-4 text-[10px] text-gray-600 flex justify-between items-center shrink-0 h-6">
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-1">
             <Cpu size={10} />
             <span>ENGINE: 32-BIT FLOAT</span>
           </div>
           <div className="flex items-center gap-1">
             <MoveHorizontal size={10} />
             <span>SCROLL: {editorState.scrollX.toFixed(2)}s</span>
           </div>
        </div>
        <div>AUDIO SPEC PRO v2.1</div>
      </footer>
    </div>
  );
}
