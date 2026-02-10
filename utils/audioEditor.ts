/**
 * Audio processing utilities for the Editor
 */

export const getAudioContext = (): AudioContext => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
};

// Robust file reading helper with multiple strategies
export const readFileAsArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
  // Strategy 1: Response API (Most Robust for memory/permissions)
  // This avoids reading the entire file into a FileReader string buffer first.
  try {
    return await new Response(blob).arrayBuffer();
  } catch (e) {
    console.warn("Response API strategy failed, falling back to FileReader", e);
  }

  // Strategy 2: FileReader (Fallback)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("Result is not an ArrayBuffer"));
      }
    };
    
    reader.onerror = () => {
      const msg = reader.error?.message || 'Unknown FileReader error';
      reject(new Error(`File read failed: ${msg}`));
    };
    
    try {
        reader.readAsArrayBuffer(blob);
    } catch (e: any) {
        reject(new Error(`Failed to initiate file read: ${e.message}`));
    }
  });
};

export const decodeAudio = async (file: File, context: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await readFileAsArrayBuffer(file);
  // Decode a copy to prevent buffer detaching issues if the arrayBuffer is reused
  return await context.decodeAudioData(arrayBuffer.slice(0));
};

export const bufferToWav = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // Write WAV Header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this encoder for compatibility)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // Write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
      view.setInt16(44 + offset, sample, true); // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArr], { type: "audio/wav" });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
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
    if (track.isAnalysisOnly) continue; // Skip large files that aren't loaded

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
  const wavBlob = bufferToWav(buffer);
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