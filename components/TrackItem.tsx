import React, { useEffect, useRef, useState } from 'react';
import { Track } from '../types';
import { Volume2, Trash2, ArrowRight } from 'lucide-react';

interface TrackItemProps {
  track: Track;
  duration: number; // Total project duration
  verticalScale: 'linear' | 'db';
  zoom: number; // pixels per second
  scrollX: number; // scroll offset in seconds
  onUpdate: (id: string, updates: Partial<Track>) => void;
  onDelete: (id: string) => void;
  onSeek: (time: number) => void;
}

export const TrackItem: React.FC<TrackItemProps> = ({ 
  track, 
  duration, 
  verticalScale, 
  zoom,
  scrollX,
  onUpdate, 
  onDelete,
  onSeek
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const [canvasHeight, setCanvasHeight] = useState(128);

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

  // Handle Click to Seek
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    // Calculate time based on scroll and zoom
    // x (pixels) / zoom (px/sec) = seconds from left edge
    // + scrollX (seconds) = absolute time
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

  // Draw Waveform (Optimized for Zoom/Scroll)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Grid lines (Time) - Optional visual aid
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    const secondWidth = zoom;
    // Calculate start second based on scroll
    const startSec = Math.floor(scrollX);
    const endSec = Math.ceil(scrollX + (width / zoom));
    
    for (let s = startSec; s <= endSec; s++) {
      const x = (s - scrollX) * zoom;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    // Center Line
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const data = track.buffer.getChannelData(0);
    const sampleRate = track.buffer.sampleRate;
    
    // Core Logic: Map pixels to audio buffer samples
    // Start sample index based on scroll
    const startSampleIndex = Math.floor(scrollX * sampleRate);
    // Samples per pixel depends on zoom
    // 1 sec = zoom pixels -> 1 pixel = 1/zoom sec -> sampleRate/zoom samples
    const samplesPerPixel = sampleRate / zoom;
    
    ctx.beginPath();
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 1;

    const mid = height / 2;
    
    // Performance optimization: Don't draw if out of bounds
    if (startSampleIndex >= data.length) return;

    // Iterate over pixels on canvas
    for (let x = 0; x < width; x++) {
      const currentSampleStart = startSampleIndex + Math.floor(x * samplesPerPixel);
      const currentSampleEnd = startSampleIndex + Math.floor((x + 1) * samplesPerPixel);
      
      if (currentSampleStart >= data.length) break;

      // Find min/max in this pixel's time slice (RMS-like visualization for zoomed out, simple for zoomed in)
      let min = 1.0;
      let max = -1.0;
      
      // Optimization: If zoomed out a lot, skip samples to keep performance
      const step = Math.max(1, Math.floor((currentSampleEnd - currentSampleStart) / 10)); 

      for (let i = currentSampleStart; i < currentSampleEnd; i += step) {
        if (i >= 0 && i < data.length) {
          const val = data[i];
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
      
      if (min <= max) {
         // Default is 0 width if silence, ensure line shows
         if (min === 1.0 && max === -1.0) { min = 0; max = 0; }
         
         const yMin = mid + min * mid * 0.95; 
         const yMax = mid + max * mid * 0.95;
         ctx.moveTo(x, yMin);
         ctx.lineTo(x, yMax);
      }
    }
    ctx.stroke();

  }, [track.buffer, track.color, zoom, scrollX, verticalScale, canvasHeight]);

  return (
    <div ref={containerRef} className="flex bg-gray-900 border border-gray-700 rounded-lg overflow-hidden min-h-[8rem] shadow-lg transition-shadow hover:shadow-xl hover:border-gray-600">
      {/* Track Controls */}
      <div className="w-56 bg-gray-800 p-3 flex flex-col justify-between border-r border-gray-700 shrink-0 gap-2 z-10 shadow-lg">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-gray-200 truncate w-32" title={track.name}>
              {track.name}
            </span>
            <button onClick={() => onDelete(track.id)} className="text-gray-500 hover:text-red-400 p-1 hover:bg-gray-700 rounded">
              <Trash2 size={14} />
            </button>
          </div>
          
          <div className="flex flex-col gap-1.5 bg-gray-900/60 p-2.5 rounded border border-gray-700/50">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase text-gray-400 font-bold tracking-widest">Format</span>
              <span className="text-[10px] font-mono text-cyan-300 truncate max-w-[120px]" title={track.originalBitDepth}>
                {track.originalBitDepth}
              </span>
            </div>
            
            <div className="flex items-start justify-between">
              <span className="text-[9px] uppercase text-gray-400 font-bold tracking-widest mt-0.5">Rate</span>
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-mono text-cyan-300">
                  {track.originalSampleRate} Hz
                </span>
                {track.originalSampleRate !== track.buffer.sampleRate && (
                  <div className="flex items-center gap-1 text-[9px] text-yellow-500 font-medium mt-0.5" title={`Resampled to ${track.buffer.sampleRate} Hz`}>
                    <ArrowRight size={8} />
                    <span>{track.buffer.sampleRate} Hz</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase text-gray-400 font-bold tracking-widest">Bitrate</span>
              <span className="text-[10px] font-mono text-emerald-300">{track.bitrate}</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={() => onUpdate(track.id, { isMuted: !track.isMuted })}
              className={`text-[10px] font-bold py-1.5 rounded transition-colors ${track.isMuted ? 'bg-red-500/20 text-red-400 border border-red-500/50' : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-transparent'}`}
            >
              MUTE
            </button>
            <button 
              onClick={() => onUpdate(track.id, { isSolo: !track.isSolo })}
              className={`text-[10px] font-bold py-1.5 rounded transition-colors ${track.isSolo ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50' : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-transparent'}`}
            >
              SOLO
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
      </div>

      {/* Vertical Ruler */}
      <div className="w-10 bg-gray-850 border-r border-gray-700 shrink-0 relative">
        <canvas ref={rulerRef} width={40} height={canvasHeight} className="w-full h-full" />
      </div>

      {/* Waveform Area */}
      <div className="flex-1 bg-gray-950 relative cursor-crosshair group">
        <canvas 
          ref={canvasRef} 
          width={1000} 
          height={canvasHeight} 
          className="w-full h-full block"
          onClick={handleCanvasClick}
        />
        <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity bg-white/5" />
      </div>
    </div>
  );
};