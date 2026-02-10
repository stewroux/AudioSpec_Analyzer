/**
 * Parses the ArrayBuffer of an audio file to find specific headers.
 * Currently optimized for WAV/RIFF to find the true Bit Depth and Sample Rate.
 */
export const parseWavHeader = (buffer: ArrayBuffer): { bitDepth: number, sampleRate: number } | null => {
  const dataView = new DataView(buffer);
  
  // Check for RIFF header
  if (dataView.byteLength < 12) return null;

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

  // Search for chunks
  let offset = 12;
  while (offset < dataView.byteLength) {
    // Ensure we have enough bytes to read chunk header (8 bytes)
    if (offset + 8 > dataView.byteLength) break;

    const chunkId = String.fromCharCode(
      dataView.getUint8(offset),
      dataView.getUint8(offset + 1),
      dataView.getUint8(offset + 2),
      dataView.getUint8(offset + 3)
    );
    
    // Chunk size is 32-bit little endian
    const chunkSize = dataView.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      // AudioFormat (2 bytes) - offset + 8
      // NumChannels (2 bytes) - offset + 10
      // SampleRate (4 bytes) - offset + 12
      // ByteRate (4 bytes) - offset + 16
      // BlockAlign (2 bytes) - offset + 20
      // BitsPerSample (2 bytes) - offset + 22 (chunk data start is offset+8, so +14 relative to data)
      
      // Ensure fmt chunk is large enough
      if (chunkSize >= 16) {
        const sampleRate = dataView.getUint32(offset + 12, true);
        const bitsPerSample = dataView.getUint16(offset + 22, true);
        return { bitDepth: bitsPerSample, sampleRate: sampleRate };
      }
    }

    // Move to next chunk
    // RIFF chunks are word-aligned (2 bytes). If chunkSize is odd, there is a padding byte.
    const padding = chunkSize % 2;
    offset += 8 + chunkSize + padding;
  }

  return null;
};

/**
 * Parses MP4/M4A container to find the original sample rate defined in the 'stsd' atom.
 * Uses a recursive approach to find atoms within their parent containers.
 */
export const parseM4aHeader = (buffer: ArrayBuffer): { sampleRate: number, codec: string } | null => {
  const dataView = new DataView(buffer);
  
  const findAtom = (start: number, end: number, targetType: string): { start: number, size: number, contentStart: number } | null => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = dataView.getUint32(offset);
      const type = String.fromCharCode(
        dataView.getUint8(offset + 4),
        dataView.getUint8(offset + 5),
        dataView.getUint8(offset + 6),
        dataView.getUint8(offset + 7)
      );

      if (type === targetType) {
        return { start: offset, size: size, contentStart: offset + 8 };
      }

      // Valid atom check
      if (size < 8) {
        // Size 1 means extended size (64-bit), Size 0 means to end of file.
        // For this simple parser, we skip complex cases or 0-size atoms unless it's the target.
        if (size === 1) {
           // Skip 64-bit size atoms for now to avoid complexity, or implement reading extra 8 bytes
           const extSize = Number(dataView.getBigUint64(offset + 8));
           offset += extSize;
           continue;
        }
        break; 
      }
      
      offset += size;
    }
    return null;
  };

  // Traversal Path: moov -> trak -> mdia -> minf -> stbl -> stsd
  const moov = findAtom(0, buffer.byteLength, 'moov');
  if (!moov) return null;

  // Find the first 'trak' inside 'moov'
  const trak = findAtom(moov.contentStart, moov.start + moov.size, 'trak');
  if (!trak) return null;

  const mdia = findAtom(trak.contentStart, trak.start + trak.size, 'mdia');
  if (!mdia) return null;

  const minf = findAtom(mdia.contentStart, mdia.start + mdia.size, 'minf');
  if (!minf) return null;

  const stbl = findAtom(minf.contentStart, minf.start + minf.size, 'stbl');
  if (!stbl) return null;

  const stsd = findAtom(stbl.contentStart, stbl.start + stbl.size, 'stsd');
  if (!stsd) return null;

  // Parse 'stsd'
  // Header: 4 bytes size, 4 bytes type, 1 byte version, 3 bytes flags, 4 bytes entry_count
  const stsdBodyStart = stsd.contentStart + 8; // +8 for version/flags/entry_count
  
  // We assume the first entry is the audio description
  // Entry header is standard atom header (4 size, 4 type)
  const entrySize = dataView.getUint32(stsdBodyStart);
  const entryType = String.fromCharCode(
    dataView.getUint8(stsdBodyStart + 4),
    dataView.getUint8(stsdBodyStart + 5),
    dataView.getUint8(stsdBodyStart + 6),
    dataView.getUint8(stsdBodyStart + 7)
  );

  // AudioSampleEntry (mp4a, alac, etc)
  // Structure relative to Entry Start (stsdBodyStart):
  // 0-7: Atom Header
  // 8-13: Reserved (6 bytes)
  // 14-15: DataReferenceIndex (2 bytes)
  // 16-23: Reserved / Version (8 bytes)
  // 24-25: ChannelCount (2 bytes)
  // 26-27: SampleSize (2 bytes)
  // 28-29: PreDefined (2 bytes)
  // 30-31: Reserved (2 bytes)
  // 32-35: SampleRate (16.16 Fixed Point)

  const sampleRateFixed = dataView.getUint32(stsdBodyStart + 32);
  const sampleRate = sampleRateFixed >>> 16; 

  return { sampleRate, codec: entryType };
};

/**
 * Heuristically detects if an M4A file is ALAC (Lossless) or AAC (Lossy).
 * Scans the first 128KB for atom signatures.
 */
export const detectM4aCodec = (buffer: ArrayBuffer): { codec: string, isLossless: boolean } | null => {
  const dataView = new DataView(buffer);
  
  if (dataView.byteLength < 8) return null;
  
  const atomType = String.fromCharCode(
      dataView.getUint8(4),
      dataView.getUint8(5),
      dataView.getUint8(6),
      dataView.getUint8(7)
  );
  if (atomType !== 'ftyp') return null;

  const limit = Math.min(buffer.byteLength, 128 * 1024);
  const bytes = new Uint8Array(buffer, 0, limit);
  
  const matchAt = (str: string, index: number) => {
    if (index + str.length > limit) return false;
    for (let i = 0; i < str.length; i++) {
        if (bytes[index + i] !== str.charCodeAt(i)) return false;
    }
    return true;
  };

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

export const estimateBitrate = (size: number, duration: number): number => {
  if (duration <= 0) return 0;
  return Math.round((size * 8) / duration / 1000);
};

/**
 * Analyzes decoded audio buffer to estimate the original bit depth.
 * Returns 16, 24, or 32 (Float).
 */
export const detectBitDepthFromBuffer = (buffer: AudioBuffer): number => {
  const channelData = buffer.getChannelData(0);
  
  let is16Bit = true;
  let is24Bit = true;
  let checks = 0;
  const maxChecks = 4000;
  const stride = 10;

  for (let i = 0; i < channelData.length; i += stride) {
    const sample = channelData[i];
    
    if (Math.abs(sample) < 1e-9) continue;

    if (is16Bit) {
      const scaled = sample * 32768;
      if (Math.abs(scaled - Math.round(scaled)) > 1e-5) {
        is16Bit = false;
      }
    }

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

  if (is16Bit && checks > 0) return 16;
  if (is24Bit && checks > 0) return 24;
  
  return 32;
};