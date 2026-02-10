export interface AudioMetadata {
  fileName: string;
  fileSize: number;
  format: string;
  duration: number;
  sampleRate: number;
  channels: number;
  detectedBitDepth: string | number;
  bitrate: number;
  isLossless: boolean;
}

export interface Track {
  id: string;
  name: string;
  file?: File;
  buffer: AudioBuffer;
  volume: number; // 0.0 to 1.0
  isMuted: boolean;
  isSolo: boolean;
  color: string;
  originalBitDepth: string; // Display string for UI (e.g., "24-bit PCM")
  originalSampleRate: number; // The true sample rate of the file, not the context
  bitrate: string; // Display string for Bitrate (e.g. "320 kbps")
}

export interface EditorState {
  isPlaying: boolean;
  currentTime: number; // in seconds
  duration: number; // max duration in seconds
  zoom: number; // pixels per second
  verticalScale: 'linear' | 'db'; // Vertical axis mode
}

export interface AiAnalysisResult {
  transcription?: string;
  summary?: string;
  type: 'transcription' | 'summary';
}