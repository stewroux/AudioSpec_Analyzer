import { GoogleGenAI } from "@google/genai";
import { audioBufferToBase64 } from "./audioEditor";

// NOTE: In a real production app, move this logic to a server-side endpoint.
// See `server/api/analyze.ts` for reference.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeAudioWithGemini = async (
  audioBuffer: AudioBuffer,
  task: 'transcribe' | 'summarize',
  lang: 'ja' | 'en'
) => {
  const base64Audio = await audioBufferToBase64(audioBuffer);
  
  const prompt = task === 'transcribe' 
    ? (lang === 'ja' ? "この音声を高精度に文字起こししてください。" : "Transcribe this audio accurately.")
    : (lang === 'ja' ? "この音声の内容を要約し、重要なポイントを箇条書きでリストアップしてください。" : "Summarize this audio and list key points.");

  // Use standard Gemini 2.5 Flash for multimodal generation
  // The 'native-audio' models are often restricted to Live API (WebSockets)
  const modelName = 'gemini-2.5-flash';

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: base64Audio
            }
          },
          { text: prompt }
        ]
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};