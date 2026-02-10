/**
 * Parses the ArrayBuffer of an audio file to find specific headers.
 * Currently optimized for WAV/RIFF to find the true Bit Depth.
 */
export const parseWavHeader = (buffer: ArrayBuffer): number | null => {
  const dataView = new DataView(buffer);
  
  // Check for RIFF header
  const riff = String.fromCharCode(
    dataView.getUint8(0),
    dataView.getUint8(1),
    dataView.getUint8(2),
    dataView.getUint8(3)
  );
  
  if (riff !== 'RIFF') return null;

  // Check for WAVE format
  const wave = String.fromCharCode(
    dataView.getUint8(8),
    dataView.getUint8(9),
    dataView.getUint8(10),
    dataView.getUint8(11)
  );

  if (wave !== 'WAVE') return null;

  // Search for "fmt " chunk
  let offset = 12;
  while (offset < dataView.byteLength) {
    const chunkId = String.fromCharCode(
      dataView.getUint8(offset),
      dataView.getUint8(offset + 1),
      dataView.getUint8(offset + 2),
      dataView.getUint8(offset + 3)
    );
    
    // Chunk size is 32-bit little endian
    const chunkSize = dataView.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      // AudioFormat (2 bytes)
      // NumChannels (2 bytes)
      // SampleRate (4 bytes)
      // ByteRate (4 bytes)
      // BlockAlign (2 bytes)
      // BitsPerSample (2 bytes) -> This is what we want! (Offset 14 bytes from chunk data start)
      
      const bitsPerSample = dataView.getUint16(offset + 8 + 14, true);
      return bitsPerSample;
    }

    // Move to next chunk
    offset += 8 + chunkSize;
  }

  return null;
};

/**
 * Heuristically detects if an M4A file is ALAC (Lossless) or AAC (Lossy).
 * Scans the first 128KB for atom signatures.
 */
export const detectM4aCodec = (buffer: ArrayBuffer): { codec: string, isLossless: boolean } | null => {
  const dataView = new DataView(buffer);
  
  // Basic check for ftyp atom at start (or at least valid container)
  if (dataView.byteLength < 8) return null;
  
  // Verify ftyp atom existence (usually at index 4)
  const atomType = String.fromCharCode(
      dataView.getUint8(4),
      dataView.getUint8(5),
      dataView.getUint8(6),
      dataView.getUint8(7)
  );
  if (atomType !== 'ftyp') return null;

  // Scan first 128KB for codec identifiers
  const limit = Math.min(buffer.byteLength, 128 * 1024);
  const bytes = new Uint8Array(buffer, 0, limit);
  
  // Simple byte matching helper
  const matchAt = (str: string, index: number) => {
    if (index + str.length > limit) return false;
    for (let i = 0; i < str.length; i++) {
        if (bytes[index + i] !== str.charCodeAt(i)) return false;
    }
    return true;
  };

  // Iterate to find 'alac' or 'mp4a'
  for (let i = 0; i < limit; i++) {
      if (bytes[i] === 97) { // 'a'
          if (matchAt('alac', i)) return { codec: 'ALAC', isLossless: true };
      }
      if (bytes[i] === 109) { // 'm'
          if (matchAt('mp4a', i)) return { codec: 'AAC', isLossless: false };
      }
  }

  return { codec: 'M4A_UNKNOWN', isLossless: false };
};

export const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 100);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
};

/**
 * Estimates bitrate in kbps based on file size and duration.
 * @param size File size in bytes
 * @param duration Duration in seconds
 */
export const estimateBitrate = (size: number, duration: number): number => {
  if (duration <= 0) return 0;
  // bytes * 8 = bits
  // bits / duration = bps
  // bps / 1000 = kbps
  return Math.round((size * 8) / duration / 1000);
};

/**
 * Analyzes decoded audio buffer to estimate the original bit depth.
 * Useful for lossless formats (ALAC, FLAC) or checking if a float buffer comes from 16/24-bit source.
 * Returns 16, 24, or 32 (Float).
 */
export const detectBitDepthFromBuffer = (buffer: AudioBuffer): number => {
  const channelData = buffer.getChannelData(0);
  
  // Check first few thousand non-silent samples
  let is16Bit = true;
  let is24Bit = true;
  let checks = 0;
  const maxChecks = 4000;
  const stride = 10;

  for (let i = 0; i < channelData.length; i += stride) {
    const sample = channelData[i];
    
    // Skip absolute silence as it fits all bit depths
    if (Math.abs(sample) < 1e-9) continue;

    // Check 16-bit: sample * 32768 should be an integer (within small tolerance)
    if (is16Bit) {
      const scaled = sample * 32768;
      if (Math.abs(scaled - Math.round(scaled)) > 1e-5) {
        is16Bit = false;
      }
    }

    // Check 24-bit: sample * 8388608 should be an integer
    if (is24Bit) {
      const scaled = sample * 8388608;
      if (Math.abs(scaled - Math.round(scaled)) > 1e-5) {
        is24Bit = false;
      }
    }

    if (!is16Bit && !is24Bit) break;
    
    checks++;
    if (checks > maxChecks) break;
  }

  // If we checked enough samples and it fits 16-bit, it's likely 16-bit.
  // 16-bit fits inside 24-bit logic, so check 16-bit first.
  if (is16Bit && checks > 0) return 16;
  if (is24Bit && checks > 0) return 24;
  
  return 32; // Default to 32-bit Float
};