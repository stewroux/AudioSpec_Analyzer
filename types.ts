export interface AudioMetadata {
  fileName: string;
  fileSize: number; // in bytes
  format: string;
  duration: number; // in seconds
  sampleRate: number; // in Hz
  channels: number;
  detectedBitDepth: string | number; // "16", "24", "32-float", or "Unknown (Compressed)"
  bitrate: number; // in kbps
  isLossless: boolean;
}

export enum AnalyzeStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}
