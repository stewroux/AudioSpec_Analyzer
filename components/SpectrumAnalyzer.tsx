import React, { useEffect, useRef } from 'react';

interface SpectrumAnalyzerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

export const SpectrumAnalyzer: React.FC<SpectrumAnalyzerProps> = ({ analyser, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isPlaying) {
        // Fade out effect when stopped
        ctx.fillStyle = 'rgba(13, 17, 23, 0.2)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw a flat line
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.strokeStyle = '#334155';
        ctx.stroke();
        return;
      }

      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      // Create gradient
      const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
      gradient.addColorStop(0, '#4f46e5'); // indigo-600
      gradient.addColorStop(0.5, '#22d3ee'); // cyan-400
      gradient.addColorStop(1, '#a5b4fc'); // indigo-300

      ctx.fillStyle = gradient;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        // Draw bar
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
        if (x > canvas.width) break;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, isPlaying]);

  return (
    <div className="w-full h-32 bg-gray-950 border-b border-gray-800 relative overflow-hidden">
      <div className="absolute top-2 left-4 text-xs font-mono text-cyan-500 opacity-70 z-10 pointer-events-none">
        REAL-TIME FREQUENCY ANALYZER
      </div>
      <canvas
        ref={canvasRef}
        width={1024}
        height={128}
        className="w-full h-full block"
      />
    </div>
  );
};