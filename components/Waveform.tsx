import React, { useEffect, useRef } from 'react';

interface WaveformProps {
  audioBuffer: AudioBuffer | null;
  color?: string;
}

export const Waveform: React.FC<WaveformProps> = ({ audioBuffer, color = '#818cf8' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !audioBuffer) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    const data = audioBuffer.getChannelData(0); // Use first channel
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.fillStyle = color;
    ctx.beginPath();
    
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      
      // Draw vertical bar for this step
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  }, [audioBuffer, color]);

  return (
    <canvas 
      ref={canvasRef} 
      width={800} 
      height={120} 
      className="w-full h-32 bg-gray-900 rounded-lg shadow-inner border border-gray-800"
    />
  );
};
