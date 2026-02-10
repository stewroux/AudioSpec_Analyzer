import React, { useEffect, useRef, useState } from 'react';
import { Track } from '../types';
import { Volume2, Trash2 } from 'lucide-react';

interface TrackItemProps {
  track: Track;
  duration: number; // Total project duration
  verticalScale: 'linear' | 'db';
  onUpdate: (id: string, updates: Partial<Track>) => void;
  onDelete: (id: string) => void;
}

export const TrackItem: React.FC<TrackItemProps> = ({ 
  track, 
  duration, 
  verticalScale, 
  onUpdate, 
  onDelete 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const [canvasHeight, setCanvasHeight] = useState(128);

  // Resize Observer to adjust canvas height based on container height (which is driven by content)
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Update canvas height to match container, ensuring 1:1 pixel mapping for sharpness
        const newHeight = Math.round(entry.contentRect.height);
        if (newHeight !== canvasHeight) {
          setCanvasHeight(newHeight);
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [canvasHeight]);

  // Draw Vertical Ruler (Scale)
  useEffect(() => {
    const canvas = rulerRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const height = canvas.height;
    const width = canvas.width;
    
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#6b7280'; // gray-500
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    if (verticalScale === 'linear') {
      // 1.0, 0.5, 0, -0.5, -1.0
      const ticks = [1.0, 0.5, 0, -0.5, -1.0];
      ticks.forEach(val => {
        const y = height / 2 - (val * height / 2); // Map 1.0 to 0, -1.0 to height
        // Adjust edges
        const drawY = Math.max(5, Math.min(height - 5, y));
        
        ctx.beginPath();
        ctx.moveTo(width - 5, drawY);
        ctx.lineTo(width, drawY);
        ctx.stroke();
        ctx.fillText(val.toFixed(1), width - 8, drawY);
      });
    } else {
      // dBFS: 0, -6, -12, -24, -inf
      // Simple mapping: 20 * log10(amp). 
      // y = height/2 - (amp * height/2). 
      const dBTicks = [0, -6, -12, -24];
      dBTicks.forEach(db => {
        const amp = Math.pow(10, db / 20);
        // Positive side
        const yPos = height / 2 - (amp * height / 2);
        // Negative side
        const yNeg = height / 2 + (amp * height / 2);

        [yPos, yNeg].forEach(y => {
           const drawY = Math.max(5, Math.min(height - 5, y));
           ctx.beginPath();
           ctx.moveTo(width - 5, drawY);
           ctx.lineTo(width, drawY);
           ctx.stroke();
        });
        ctx.fillText(db.toString(), width - 8, Math.max(5, Math.min(height - 5, height / 2 - (amp * height / 2))));
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

    // Background
    ctx.fillStyle = '#0f172a'; // slate-950
    ctx.fillRect(0, 0, width, height);

    // Center Line
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const data = track.buffer.getChannelData(0);
    const samplesPerPixel = (duration * track.buffer.sampleRate) / width;
    
    ctx.beginPath();
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 1;

    const mid = height / 2;

    for (let x = 0; x < width; x++) {
      const startSample = Math.floor(x * samplesPerPixel);
      if (startSample >= data.length) break;

      let min = 1.0;
      let max = -1.0;
      const endSample = Math.floor((x + 1) * samplesPerPixel);
      const step = Math.max(1, Math.floor((endSample - startSample) / 10)); 

      for (let i = startSample; i < endSample; i += step) {
        if (i < data.length) {
          const val = data[i];
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
      
      if (min <= max) {
         // Transform based on Vertical Scale?
         const yMin = mid + min * mid * 0.95; // 0.95 to avoid edge clipping
         const yMax = mid + max * mid * 0.95;
         ctx.moveTo(x, yMin);
         ctx.lineTo(x, yMax);
      }
    }
    ctx.stroke();

  }, [track.buffer, track.color, duration, verticalScale, canvasHeight]);

  return (
    <div ref={containerRef} className="flex bg-gray-900 border border-gray-700 rounded-lg overflow-hidden min-h-[8rem]">
      {/* Track Controls */}
      <div className="w-56 bg-gray-800 p-3 flex flex-col justify-between border-r border-gray-700 shrink-0 gap-2">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-gray-200 truncate w-32" title={track.name}>
              {track.name}
            </span>
            <button onClick={() => onDelete(track.id)} className="text-gray-500 hover:text-red-400">
              <Trash2 size={14} />
            </button>
          </div>
          
          <div className="flex flex-col gap-1 bg-gray-900/50 p-2 rounded">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Fmt</span>
              <span className="text-xs font-mono text-cyan-400 truncate max-w-[140px]" title={track.originalBitDepth}>{track.originalBitDepth}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Rate</span>
              <span className="text-xs font-mono text-cyan-400">{track.buffer.sampleRate} Hz</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Bitrate</span>
              <span className="text-xs font-mono text-cyan-400">{track.bitrate}</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button 
              onClick={() => onUpdate(track.id, { isMuted: !track.isMuted })}
              className={`flex-1 text-xs py-1 rounded border ${track.isMuted ? 'bg-red-900/50 text-red-300 border-red-700' : 'bg-gray-700 text-gray-300 border-gray-600'}`}
            >
              Mute
            </button>
            <button 
              onClick={() => onUpdate(track.id, { isSolo: !track.isSolo })}
              className={`flex-1 text-xs py-1 rounded border ${track.isSolo ? 'bg-yellow-900/50 text-yellow-300 border-yellow-700' : 'bg-gray-700 text-gray-300 border-gray-600'}`}
            >
              Solo
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Volume2 size={14} className="text-gray-400" />
            <input 
              type="range" 
              min="0" 
              max="1.2" 
              step="0.05" 
              value={track.volume}
              onChange={(e) => onUpdate(track.id, { volume: parseFloat(e.target.value) })}
              className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:rounded-full"
            />
          </div>
        </div>
      </div>

      {/* Vertical Ruler */}
      <div className="w-10 bg-gray-850 border-r border-gray-700 shrink-0 relative">
        <canvas ref={rulerRef} width={40} height={canvasHeight} className="w-full h-full" />
      </div>

      {/* Waveform Area */}
      <div className="flex-1 bg-gray-950 relative">
        <canvas 
          ref={canvasRef} 
          width={1000} 
          height={canvasHeight} 
          className="w-full h-full block"
        />
        {/* Clips/Regions would be overlaid here in a full DAW */}
      </div>
    </div>
  );
};
