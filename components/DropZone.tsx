import React, { useCallback } from 'react';
import { Upload, Music, FileAudio } from 'lucide-react';

interface DropZoneProps {
  onFileSelected: (file: File) => void;
  isProcessing: boolean;
  labels: {
    idle: string;
    processing: string;
    supports: string;
  };
}

export const DropZone: React.FC<DropZoneProps> = ({ onFileSelected, isProcessing, labels }) => {
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelected(e.dataTransfer.files[0]);
    }
  }, [onFileSelected]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelected(e.target.files[0]);
    }
  }, [onFileSelected]);

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative group cursor-pointer flex flex-col items-center justify-center w-full h-64 rounded-2xl border-2 border-dashed transition-all duration-300 ${
        isProcessing
          ? 'border-indigo-500/50 bg-indigo-500/5 cursor-wait'
          : 'border-gray-700 hover:border-indigo-500 hover:bg-gray-900/50 bg-gray-900/20'
      }`}
    >
      <input
        type="file"
        accept="audio/*,.m4a"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait"
        onChange={handleInputChange}
        disabled={isProcessing}
      />
      
      <div className="flex flex-col items-center space-y-4 text-center p-6">
        <div className={`p-4 rounded-full transition-transform duration-300 ${isProcessing ? 'animate-pulse bg-indigo-500/20' : 'bg-gray-800 group-hover:bg-gray-700 group-hover:scale-110'}`}>
          {isProcessing ? (
            <Music className="w-8 h-8 text-indigo-400" />
          ) : (
            <Upload className="w-8 h-8 text-indigo-400" />
          )}
        </div>
        
        <div className="space-y-1">
          <p className="text-lg font-medium text-gray-200">
            {isProcessing ? labels.processing : labels.idle}
          </p>
          <p className="text-sm text-gray-500">
            {labels.supports}
          </p>
        </div>
        
        {!isProcessing && (
          <div className="flex gap-2">
            <span className="px-2 py-1 text-xs font-mono bg-gray-800 text-gray-400 rounded">.WAV</span>
            <span className="px-2 py-1 text-xs font-mono bg-gray-800 text-gray-400 rounded">.FLAC</span>
            <span className="px-2 py-1 text-xs font-mono bg-gray-800 text-gray-400 rounded">.M4A</span>
            <span className="px-2 py-1 text-xs font-mono bg-gray-800 text-gray-400 rounded">.MP3</span>
          </div>
        )}
      </div>
    </div>
  );
};
