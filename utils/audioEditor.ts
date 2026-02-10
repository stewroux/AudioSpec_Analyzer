/**
 * Audio processing utilities for the Editor
 */

export const getAudioContext = (): AudioContext => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
};

export const decodeAudio = async (file: File, context: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return await context.decodeAudioData(arrayBuffer);
};

/**
 * Exports AudioBuffer to WAV format with specified bit depth.
 * @param buffer AudioBuffer to export
 * @param bitDepth 16, 24, or 32 (Float)
 */
export const bufferToWav = (buffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const lengthSamples = buffer.length * numOfChan;
  const bytesPerSample = bitDepth / 8;
  const fileLength = 44 + lengthSamples * bytesPerSample;
  
  const bufferArr = new ArrayBuffer(fileLength);
  const view = new DataView(bufferArr);
  const channels = [];
  let pos = 0;

  // --- WAV Header ---
  const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };

  setUint32(0x46464952); // "RIFF"
  setUint32(fileLength - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  
  // Format Code: 1 for PCM (Integer), 3 for IEEE Float
  const formatCode = bitDepth === 32 ? 3 : 1; 
  setUint16(formatCode);
  
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(sampleRate * numOfChan * bytesPerSample); // byte rate
  setUint16(numOfChan * bytesPerSample); // block-align
  setUint16(bitDepth); // bits per sample

  setUint32(0x61746164); // "data" - chunk
  setUint32(lengthSamples * bytesPerSample); // chunk length

  // --- Audio Data ---
  
  // Get all channel data
  for (let i = 0; i < numOfChan; i++) {
    channels.push(buffer.getChannelData(i));
  }

  // Interleave and Write
  let offset = 44; // Start of data
  
  if (bitDepth === 16) {
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numOfChan; ch++) {
        let sample = channels[ch][i];
        sample = Math.max(-1, Math.min(1, sample)); // clamp
        // Scale to 16-bit signed: -32768 to 32767
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numOfChan; ch++) {
        let sample = channels[ch][i];
        sample = Math.max(-1, Math.min(1, sample)); // clamp
        // Scale to 24-bit signed: -8388608 to 8388607
        sample = sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF;
        const intSample = Math.round(sample);
        
        // Write 3 bytes (little endian)
        view.setUint8(offset, intSample & 0xFF);
        view.setUint8(offset + 1, (intSample >> 8) & 0xFF);
        view.setUint8(offset + 2, (intSample >> 16) & 0xFF);
        offset += 3;
      }
    }
  } else if (bitDepth === 32) {
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numOfChan; ch++) {
        // IEEE 754 Float
        view.setFloat32(offset, channels[ch][i], true);
        offset += 4;
      }
    }
  }

  return new Blob([bufferArr], { type: "audio/wav" });
};

// Mix multiple tracks into a single AudioBuffer
export const mixTracks = (
  tracks: import('../types').Track[], 
  context: AudioContext, 
  duration: number
): AudioBuffer => {
  const sampleRate = context.sampleRate;
  const length = Math.ceil(duration * sampleRate);
  const outputBuffer = context.createBuffer(2, length, sampleRate); // Always stereo mix
  
  // Identify active tracks
  const soloTracks = tracks.filter(t => t.isSolo);
  const activeTracks = soloTracks.length > 0 ? soloTracks : tracks.filter(t => !t.isMuted);

  for (const track of activeTracks) {
    const trackBuffer = track.buffer;
    const trackLen = Math.min(length, trackBuffer.length);
    
    for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
      const outputData = outputBuffer.getChannelData(channel);
      // Map track channel to output channel (simple mono/stereo mapping)
      const trackChannelData = trackBuffer.getChannelData(channel % trackBuffer.numberOfChannels);
      
      for (let i = 0; i < trackLen; i++) {
        outputData[i] += trackChannelData[i] * track.volume;
      }
    }
  }

  return outputBuffer;
};

// Convert AudioBuffer to Base64 for Gemini
export const audioBufferToBase64 = async (buffer: AudioBuffer): Promise<string> => {
  // Use 16-bit for Gemini Analysis to keep payload size reasonable
  const wavBlob = bufferToWav(buffer, 16);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:audio/wav;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(wavBlob);
  });
};