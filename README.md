# AudioSpec Analyzer

AudioSpec Analyzer is a high-performance, client-side web application designed for audiophiles and sound engineers. It provides deep inspection of audio files directly in the browser, extracting critical technical metadata that standard media players often hide.

## 🌟 Key Features

- **Universal Analysis**: Supports major audio formats including **WAV, FLAC, M4A, MP3, AAC, OGG**.
- **True Bit Depth Detection**:
  - Unlike standard Web Audio API (which up-samples everything to 32-bit float), this app parses binary headers (RIFF/WAV) to detect the *actual* source bit depth (16-bit, 24-bit, etc.).
  - **M4A Deep Scan**: Distinguishes between **Apple Lossless (ALAC)** and **AAC (Lossy)** by analyzing atom signatures.
- **Signal Analysis**: Extracts Sample Rate (Hz), Channel Count, and accurate Bitrate (kbps).
- **Visualizer**: Renders a real-time waveform of the audio signal.
- **Privacy First**: All processing happens 100% client-side. No files are ever uploaded to a server.
- **Bilingual UI**: Seamless switching between **Japanese** and **English**.

## 🚀 Supported Formats

| Extension | Analysis Type | Details |
|-----------|---------------|---------|
| `.wav` | **Deep Header Scan** | Detects 16/24/32-bit integer or float source depth. |
| `.m4a` | **Container Scan** | Identifies Codec (ALAC vs AAC). |
| `.flac` | Signal Analysis | Reports as Variable Bit Depth (Lossless). |
| `.mp3` | Signal Analysis | Bitrate, Sample Rate, Channels. |
| `.aac` | Signal Analysis | Bitrate, Sample Rate, Channels. |
| `.ogg` | Signal Analysis | Bitrate, Sample Rate, Channels. |

## 🛠 Technical Stack

- **Frontend Framework**: React 19
- **Styling**: Tailwind CSS (Dark Mode optimized)
- **Icons**: Lucide React
- **Language**: TypeScript
- **Audio Processing**: 
  - `AudioContext` for signal decoding.
  - `DataView` for binary header parsing.

## 📦 Installation & Running

This project is built as a standard React application.

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Build for Production**
   ```bash
   npm run build
   ```

## 📝 License

MIT License
