/**
 * Parses the ArrayBuffer of an audio file to find specific headers.
 * Currently optimized for WAV/RIFF to find the true Bit Depth and Sample Rate.
 */
export const parseWavHeader = (buffer: ArrayBuffer): { bitDepth: number, sampleRate: number } | null => {
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
      // AudioFormat (2 bytes) - offset + 8
      // NumChannels (2 bytes) - offset + 10
      // SampleRate (4 bytes) - offset + 12
      // ByteRate (4 bytes) - offset + 16
      // BlockAlign (2 bytes) - offset + 20
      // BitsPerSample (2 bytes) - offset + 22 (chunk data start is offset+8, so +14 relative to data)
      
      const sampleRate = dataView.getUint32(offset + 12, true);
      const bitsPerSample = dataView.getUint16(offset + 22, true);
      
      return { bitDepth: bitsPerSample, sampleRate: sampleRate };
    }

    // Move to next chunk
    offset += 8 + chunkSize;
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

      // Atom size 0 means "rest of file", size 1 means extended size (64bit)
      // For simplicity in this lightweight parser, we assume standard 32-bit sizes for headers
      if (size < 8) break; 
      
      // If we are searching for a nested atom, we might need to go INTO containers (moov, trak, mdia, minf, stbl)
      // But this linear scan at the current level skips siblings. 
      // We implement "Path" logic outside.
      offset += size;
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
  // Inside moov, we scan linearly for the first trak
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
  // Header: 4 bytes size, 4 bytes type, 1 byte version, 3 bytes flags, 4 bytes entry_count
  const stsdBodyStart = stsd.start + 16; 
  // We assume the first entry is the audio description
  const entrySize = dataView.getUint32(stsdBodyStart);
  const entryType = String.fromCharCode(
    dataView.getUint8(stsdBodyStart + 4),
    dataView.getUint8(stsdBodyStart + 5),
    dataView.getUint8(stsdBodyStart + 6),
    dataView.getUint8(stsdBodyStart + 7)
  );

  // Parse AudioSampleEntry (mp4a, alac, etc)
  // Structure (relative to entry start):
  // 0-7: Header
  // 8-13: Reserved
  // 14-15: DataRefIndex
  // 16-23: Reserved (Version/Revision/Vendor in QT)
  // 24-25: ChannelCount
  // 26-27: SampleSize
  // 28-29: PreDefined
  // 30-31: Reserved
  // 32-35: SampleRate (16.16 Fixed Point)

  const sampleRateFixed = dataView.getUint32(stsdBodyStart + 32);
  const sampleRate = sampleRateFixed >>> 16; // Shift right 16 bits to get integer part

  return { sampleRate, codec: entryType };
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