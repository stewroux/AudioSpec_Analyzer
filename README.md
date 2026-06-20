# AudioSpec Editor + Gemini

A browser-based multi-track audio editor (DAW) powered by Google Gemini AI. Import, record, mix, and analyze audio directly in your browser.

## 🌟 Key Features

- **Multi-Track Editing**:
  - Import WAV, MP3, M4A, FLAC.
  - Microphone Recording.
  - Solo / Mute / Volume controls per track.
  - Real-time Waveform visualization.
- **Deep Technical Inspection**:
  - **True Bit Depth Detection**: Identifies 16/24-bit integer sources from WAV headers before float conversion.
  - **Vertical Scale**: Switchable Linear vs dBFS waveform views.
  - **Internal Processing**: Explicit 32-bit float pipeline visualization.
- **Gemini AI Integration**:
  - **Transcription**: Convert spoken audio to text.
  - **Summarization**: Generate summaries of audio content.
- **Export**: Mixdown your project to a stereo WAV file.

## 📋 Requirements

- **Node.js** >= 20 (CI runs on 20 and 22)
- **npm** >= 10
- A **Google Gemini API key** — get one at <https://aistudio.google.com/apikey>

## 🚀 Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Set API Key**

   ```bash
   cp .env.example .env
   # then edit .env and set GEMINI_API_KEY (and SERVER_SIDE_API_KEY for the server)
   ```

   Vite injects `GEMINI_API_KEY` into the client at build time (see `vite.config.ts`).

3. **Run Development Server**
   ```bash
   npm run dev
   ```

## 🔐 Security Note

This app runs AI analysis client-side for demonstration. For production, deploy the server-side reference implementation found in `server/api/analyze.ts` to protect your API keys.

## 🛠 Technical Stack

- **Framework**: React 19
- **Audio Engine**: Native Web Audio API (AudioContext)
- **AI**: Gemini 2.5 Flash
- **Styling**: Tailwind CSS

## 📝 License

MIT License
