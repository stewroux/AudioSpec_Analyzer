/**
 * EXAMPLE SERVER-SIDE IMPLEMENTATION
 * 
 * This file demonstrates how to move the Gemini API call to a secure backend environment.
 * Client-side code should POST the audio file to this endpoint.
 */

/*
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.SERVER_SIDE_API_KEY });

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const task = formData.get('task') as string;

    if (!file) {
      return new Response("No file provided", { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    const prompt = task === 'transcribe' 
      ? "Transcribe this audio." 
      : "Summarize this audio.";

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: file.type || 'audio/wav',
              data: base64Audio
            }
          },
          { text: prompt }
        ]
      }
    });

    return new Response(JSON.stringify({ text: response.text }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response("Internal Server Error", { status: 500 });
  }
}
*/
