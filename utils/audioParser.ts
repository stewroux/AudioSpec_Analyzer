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
 * Scans all tracks to find an audio track.
 */
export const parseM4aHeader = (buffer: ArrayBuffer): { sampleRate: number, codec: string } | null => {
  const dataView = new DataView(buffer);
  
  // Helper to read 4-char code
  const getFourCC = (offset: number) => {
    return String.fromCharCode(
      dataView.getUint8(offset),
      dataView.getUint8(offset + 1),
      dataView.getUint8(offset + 2),
      dataView.getUint8(offset + 3)
    );
  };

  // Iterates over child atoms of a container
  const iterateAtoms = (start: number, end: number, callback: (type: string, start: number, size: number, contentStart: number) => void) => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = dataView.getUint32(offset);
      const type = getFourCC(offset + 4);
      
      if (size < 8) {
         if (size === 1) {
           const extSize = Number(dataView.getBigUint64(offset + 8));
           callback(type, offset, extSize, offset + 16);
           offset += extSize;
           continue;
         }
         break; // Invalid or 0 (to EOF)
      }

      callback(type, offset, size, offset + 8);
      offset += size;
    }
  };

  let result: { sampleRate: number, codec: string } | null = null;

  const moov = (() => {
    let found = null;
    iterateAtoms(0, buffer.byteLength, (type, start, size, contentStart) => {
      if (type === 'moov') found = { start, size, contentStart };
    });
    return found;
  })();
  
  if (!moov) return null;

  // Search inside moov for tracks
  const searchTrack = (trakStart: number, trakSize: number, trakContentStart: number) => {
    let mdia: any = null;
    iterateAtoms(trakContentStart, trakStart + trakSize, (type, s, z, c) => {
       if (type === 'mdia') mdia = { s, z, c };
    });
    if (!mdia) return;

    let minf: any = null;
    iterateAtoms(mdia.c, mdia.s + mdia.z, (type, s, z, c) => {
       if (type === 'minf') minf = { s, z, c };
    });
    if (!minf) return;

    let stbl: any = null;
    iterateAtoms(minf.c, minf.s + minf.z, (type, s, z, c) => {
       if (type === 'stbl') stbl = { s, z, c };
    });
    if (!stbl) return;

    let stsd: any = null;
    iterateAtoms(stbl.c, stbl.s + stbl.z, (type, s, z, c) => {
       if (type === 'stsd') stsd = { s, z, c };
    });
    if (!stsd) return;

    // Parse stsd
    // Header: 4 bytes size, 4 bytes type, 1 byte version, 3 bytes flags, 4 bytes entry_count
    const stsdBodyStart = stsd.c + 8;
    const entryCount = dataView.getUint32(stsd.c + 4); // technically at offset+4 inside content is version/flags, count is at +8 relative to atom start? No.
    // stsd version (1) + flags (3) + count (4) = 8 bytes.
    
    // We only check the first entry for simplicity, or iterate if needed
    if (stsdBodyStart + 8 > stbl.s + stbl.z) return;

    const entrySize = dataView.getUint32(stsdBodyStart);
    const entryType = getFourCC(stsdBodyStart + 4);

    // Check for known audio formats
    if (['mp4a', 'alac', 'samr', 'ulaw', 'alaw', 'lpcm'].includes(entryType)) {
      // AudioSampleEntry
      // Sample Rate is at offset 32 relative to entry start (16.16 fixed point)
      // entry start = stsdBodyStart
      const sampleRateFixed = dataView.getUint32(stsdBodyStart + 32);
      const sampleRate = sampleRateFixed >>> 16;
      
      // If we found a valid audio track, set result and stop
      if (sampleRate > 0) {
        result = { sampleRate, codec: entryType };
      }
    }
  };

  // Iterate all tracks in moov
  iterateAtoms(moov.contentStart, moov.start + moov.size, (type, start, size, contentStart) => {
    if (result) return; // Found one already
    if (type === 'trak') {
      searchTrack(start, size, contentStart);
    }
  });

  return result;
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