/**
 * Parses the ArrayBuffer of an audio file to find specific headers.
 * Currently optimized for WAV/RIFF to find the true Bit Depth and Sample Rate.
 */
export const parseWavHeader = (buffer: ArrayBuffer): { bitDepth: number, sampleRate: number } | null => {
  const dataView = new DataView(buffer);
  
  if (dataView.byteLength < 12) return null;

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
  while (offset + 8 <= dataView.byteLength) {
    const chunkId = String.fromCharCode(
      dataView.getUint8(offset),
      dataView.getUint8(offset + 1),
      dataView.getUint8(offset + 2),
      dataView.getUint8(offset + 3)
    );
    
    // Chunk size is 32-bit little endian
    const chunkSize = dataView.getUint32(offset + 4, true);

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      if (offset + 24 > dataView.byteLength) break; // Check bounds for format struct
      
      const sampleRate = dataView.getUint32(offset + 12, true);
      const bitsPerSample = dataView.getUint16(offset + 22, true);
      
      return { bitDepth: bitsPerSample, sampleRate: sampleRate };
    }

    // Move to next chunk
    const nextOffset = offset + 8 + chunkSize;
    if (nextOffset <= offset) break; // Overflow protection
    offset = nextOffset;
  }

  return null;
};

/**
 * Parses MP4/M4A container to find the original sample rate defined in the 'stsd' atom.
 * This is necessary because Web Audio API resamples everything to the context rate.
 */
export const parseM4aHeader = (buffer: ArrayBuffer): { sampleRate: number, codec: string } | null => {
  const dataView = new DataView(buffer);
  
  const findAtom = (start: number, end: number, targetType: string): { start: number, size: number } | null => {
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
        return { start: offset, size: size };
      }

      if (size < 8) break; 
      
      offset += size;
      if (offset > end) break;
    }
    return null;
  };

  const getAtomContent = (start: number, size: number) => {
    return { start: start + 8, end: start + size };
  };

  // 1. Find 'moov' (Movie Atom)
  const moov = findAtom(0, buffer.byteLength, 'moov');
  if (!moov) return null;

  // 2. Find 'trak' (Track Atom) - Use the first track
  const moovContent = getAtomContent(moov.start, moov.size);
  const trak = findAtom(moovContent.start, moovContent.end, 'trak');
  if (!trak) return null;

  // 3. Find 'mdia' (Media Atom)
  const trakContent = getAtomContent(trak.start, trak.size);
  const mdia = findAtom(trakContent.start, trakContent.end, 'mdia');
  if (!mdia) return null;

  // 4. Find 'minf' (Media Information Atom)
  const mdiaContent = getAtomContent(mdia.start, mdia.size);
  const minf = findAtom(mdiaContent.start, mdiaContent.end, 'minf');
  if (!minf) return null;

  // 5. Find 'stbl' (Sample Table Atom)
  const minfContent = getAtomContent(minf.start, minf.size);
  const stbl = findAtom(minfContent.start, minfContent.end, 'stbl');
  if (!stbl) return null;

  // 6. Find 'stsd' (Sample Description Atom)
  const stblContent = getAtomContent(stbl.start, stbl.size);
  const stsd = findAtom(stblContent.start, stblContent.end, 'stsd');
  if (!stsd) return null;

  // Parse 'stsd'
  const stsdBodyStart = stsd.start + 16; 
  if (stsdBodyStart + 36 > buffer.byteLength) return null;

  const entryType = String.fromCharCode(
    dataView.getUint8(stsdBodyStart + 4),
    dataView.getUint8(stsdBodyStart + 5),
    dataView.getUint8(stsdBodyStart + 6),
    dataView.getUint8(stsdBodyStart + 7)
  );

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