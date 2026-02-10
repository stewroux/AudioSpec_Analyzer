import React, { useEffect, useRef, useState } from 'react';
import { Track } from '../types';
import { Volume2, Trash2, ArrowRight, Wand2, Scissors, Waves, MicOff, MoreVertical, HardDrive } from 'lucide-react';

interface TrackItemProps {
  track: Track;
  duration: number; // Total project duration
  verticalScale: 'linear' | 'db';
  zoom: number; // pixels per second
  scrollX: number; // scroll offset in seconds
  onUpdate: (id: string, updates: Partial<Track>) => void;
  onDelete: (id: string) => void;
  onSeek: (time: number) => void;
  onProcess: (id: string, type: 'silence' | 'denoise' | 'gate') => void;
  labels: {
    menuTitle: string;
    removeSilence: string;
    denoise: string;
    removeFiller: string;
    mute: string;
    solo: string;
  };
}

export const TrackItem: React.FC<TrackItemProps> = ({ 
  track, 
  duration, 
  verticalScale, 
  zoom,
  scrollX,
  onUpdate, 
  onDelete,
  onSeek,
  onProcess,
  labels
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const [canvasHeight, setCanvasHeight] = useState(128);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Resize Observer
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = Math.round(entry.contentRect.height);
        if (newHeight !== canvasHeight) setCanvasHeight(newHeight);
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [canvasHeight]);

  // Handle Click Outside Menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle Click to Seek
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (track.isAnalysisOnly) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const time = (x / zoom) + scrollX;
    onSeek(Math.max(0, Math.min(time, duration)));
  };

  // Draw Vertical Ruler
  useEffect(() => {
    const canvas = rulerRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const height = canvas.height;
    const width = canvas.width;
    
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#6b7280';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    if (verticalScale === 'linear') {
      [1.0, 0.5, 0, -0.5, -1.0].forEach(val => {
        const y = height / 2 - (val * height / 2);
        const drawY = Math.max(5, Math.min(height - 5, y));
        ctx.beginPath(); ctx.moveTo(width - 5, drawY); ctx.lineTo(width, drawY); ctx.stroke();
        ctx.fillText(val.toFixed(1), width - 8, drawY);
      });
    } else {
      [0, -6, -12, -24].forEach(db => {
        const amp = Math.pow(10, db / 20);
        const yPos = height / 2 - (amp * height / 2);
        const yNeg = height / 2 + (amp * height / 2);
        [yPos, yNeg].forEach(y => {
           const drawY = Math.max(5, Math.min(height - 5, y));
           ctx.beginPath(); ctx.moveTo(width - 5, drawY); ctx.lineTo(width, drawY); ctx.stroke();
        });
        ctx.fillText(db.toString(), width - 8, height / 2 - (amp * height / 2));
      });
    }
  }, [verticalScale, canvasHeight]);

  // Draw Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    if (track.isAnalysisOnly) {
      // Draw Placeholder for Analysis Only
      ctx.strokeStyle = '#334155';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = '#475569';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText("Large File Mode - Waveform Unavailable", width / 2, height / 2 - 10);
      ctx.fillText("(Metadata Analysis Only)", width / 2, height / 2 + 10);
      return;
    }

    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    const startSec = Math.floor(scrollX);
    const endSec = Math.ceil(scrollX + (width / zoom));
    
    for (let s = startSec; s <= endSec; s++) {
      const x = (s - scrollX) * zoom;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const data = track.buffer.getChannelData(0);
    const sampleRate = track.buffer.sampleRate;
    const startSampleIndex = Math.floor(scrollX * sampleRate);
    const samplesPerPixel = sampleRate / zoom;
    
    ctx.beginPath();
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 1;

    const mid = height / 2;
    if (startSampleIndex >= data.length) return;

    for (let x = 0; x < width; x++) {
      const currentSampleStart = startSampleIndex + Math.floor(x * samplesPerPixel);
      const currentSampleEnd = startSampleIndex + Math.floor((x + 1) * samplesPerPixel);
      
      if (currentSampleStart >= data.length) break;

      let min = 1.0;
      let max = -1.0;
      const step = Math.max(1, Math.floor((currentSampleEnd - currentSampleStart) / 10)); 

      for (let i = currentSampleStart; i < currentSampleEnd; i += step) {
        if (i >= 0 && i < data.length) {
          const val = data[i];
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
      
      if (min <= max) {
         if (min === 1.0 && max === -1.0) { min = 0; max = 0; }
         const yMin = mid + min * mid * 0.95; 
         const yMax = mid + max * mid * 0.95;
         ctx.moveTo(x, yMin);
         ctx.lineTo(x, yMax);
      }
    }
    ctx.stroke();
  }, [track.buffer, track.color, zoom, scrollX, verticalScale, canvasHeight, track.isAnalysisOnly]);

  return (
    <div ref={containerRef} className="flex bg-gray-900 border border-gray-700 rounded-lg overflow-hidden min-h-[8rem] shadow-lg transition-shadow hover:shadow-xl hover:border-gray-600 relative">
      
      {/* Track Controls */}
      <div className="w-56 bg-gray-800 p-3 flex flex-col justify-between border-r border-gray-700 shrink-0 gap-2 z-10 shadow-lg relative">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-gray-200 truncate w-24" title={track.name}>
              {track.name}
            </span>
            <div className="flex items-center gap-1">
              {!track.isAnalysisOnly && (
                <div className="relative">
                  <button 
                    onClick={() => setShowMenu(!showMenu)}
                    className={`p-1 rounded hover:bg-gray-700 transition-colors ${showMenu ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
                    title={labels.menuTitle}
                  >
                    <Wand2 size={14} />
                  </button>
                  
                  {/* Process Menu */}
                  {showMenu && (
                    <div ref={menuRef} className="absolute left-0 top-full mt-1 w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-900/50">{labels.menuTitle}</div>
                      <button 
                        onClick={() => { onProcess(track.id, 'silence'); setShowMenu(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-indigo-600 hover:text-white flex items-center gap-2"
                      >
                        <Scissors size={12} /> {labels.removeSilence}
                      </button>
                      <button 
                        onClick={() => { onProcess(track.id, 'denoise'); setShowMenu(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-indigo-600 hover:text-white flex items-center gap-2"
                      >
                        <Waves size={12} /> {labels.denoise}
                      </button>
                      <button 
                        onClick={() => { onProcess(track.id, 'gate'); setShowMenu(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-indigo-600 hover:text-white flex items-center gap-2"
                      >
                        <MicOff size={12} /> {labels.removeFiller}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => onDelete(track.id)} className="text-gray-500 hover:text-red-400 p-1 hover:bg-gray-700 rounded">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          
          <div className="flex flex-col gap-1.5 bg-gray-900/60 p-2.5 rounded border border-gray-700/50">
             {/* Info block */}
             <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase text-gray-400 font-bold tracking-widest">Rate</span>
              <span className="text-[10px] font-mono text-cyan-300">{track.originalSampleRate} Hz</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase text-gray-400 font-bold tracking-widest">Bitrate</span>
              <span className="text-[10px] font-mono text-emerald-300">{track.bitrate}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-700/50 pt-1 mt-1">
               <span className="text-[9px] uppercase text-gray-400 font-bold tracking-widest">Fmt</span>
               <span className="text-[9px] font-mono text-indigo-300 truncate max-w-[80px]" title={track.originalBitDepth}>
                  {track.originalBitDepth}
               </span>
            </div>
          </div>
        </div>
        
        {track.isAnalysisOnly ? (
          <div className="flex items-center justify-center gap-2 p-2 bg-yellow-900/20 border border-yellow-700/30 rounded text-yellow-500 text-xs">
             <HardDrive size={14} />
             <span className="font-bold">Metadata Only</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => onUpdate(track.id, { isMuted: !track.isMuted })}
                className={`text-[10px] font-bold py-1.5 rounded transition-colors ${track.isMuted ? 'bg-red-500/20 text-red-400 border border-red-500/50' : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-transparent'}`}
              >
                {labels.mute}
              </button>
              <button 
                onClick={() => onUpdate(track.id, { isSolo: !track.isSolo })}
                className={`text-[10px] font-bold py-1.5 rounded transition-colors ${track.isSolo ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50' : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-transparent'}`}
              >
                {labels.solo}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Volume2 size={14} className="text-gray-400" />
              <div className="relative w-full h-4 flex items-center">
                <input 
                  type="range" 
                  min="0" 
                  max="1.2" 
                  step="0.05" 
                  value={track.volume}
                  onChange={(e) => onUpdate(track.id, { volume: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-indigo-400 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:hover:scale-125 transition-all"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Vertical Ruler */}
      <div className="w-10 bg-gray-850 border-r border-gray-700 shrink-0 relative">
        <canvas ref={rulerRef} width={40} height={canvasHeight} className="w-full h-full" />
      </div>

      {/* Waveform Area */}
      <div className={`flex-1 bg-gray-950 relative ${!track.isAnalysisOnly ? 'cursor-crosshair group' : ''}`}>
        <canvas 
          ref={canvasRef} 
          width={1000} 
          height={canvasHeight} 
          className="w-full h-full block"
          onClick={handleCanvasClick}
        />
        {!track.isAnalysisOnly && (
          <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity bg-white/5" />
        )}
      </div>
    </div>
  );
};