import React, { useState } from 'react';
import { DropZone } from './components/DropZone';
import { Waveform } from './components/Waveform';
import { parseWavHeader, detectM4aCodec, formatBytes, formatDuration } from './utils/audioParser';
import { AudioMetadata, AnalyzeStatus } from './types';
import { Activity, FileAudio, Info, Mic2, AlertCircle, CheckCircle2, Globe } from 'lucide-react';
import { translations, Language } from './utils/i18n';

export default function App() {
  const [lang, setLang] = useState<Language>('ja');
  const [status, setStatus] = useState<AnalyzeStatus>(AnalyzeStatus.IDLE);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const t = translations[lang];

  const toggleLanguage = () => {
    setLang(prev => prev === 'en' ? 'ja' : 'en');
  };

  const processFile = async (file: File) => {
    setStatus(AnalyzeStatus.PROCESSING);
    setErrorMsg('');
    setMetadata(null);
    setAudioBuffer(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      setAudioBuffer(buffer);

      let detectedBitDepth: string | number = "UNKNOWN";
      let isLossless = false;

      const fileName = file.name.toLowerCase();
      const fileType = file.type;

      // WAV Analysis
      if (fileType === 'audio/wav' || fileName.endsWith('.wav')) {
        const bits = parseWavHeader(arrayBuffer);
        if (bits) {
          detectedBitDepth = bits;
          isLossless = true;
        } else {
          detectedBitDepth = "FLOAT";
        }
      } 
      // FLAC Analysis
      else if (fileType === 'audio/flac' || fileName.endsWith('.flac')) {
        detectedBitDepth = "VARIABLE";
        isLossless = true;
      }
      // M4A / MP4 Analysis
      else if (fileType.includes('m4a') || fileType.includes('mp4') || fileName.endsWith('.m4a') || fileName.endsWith('.mp4')) {
        const m4aInfo = detectM4aCodec(arrayBuffer);
        if (m4aInfo) {
          detectedBitDepth = m4aInfo.codec; // 'ALAC', 'AAC', 'M4A_UNKNOWN'
          isLossless = m4aInfo.isLossless;
        } else {
          detectedBitDepth = "M4A_CONTAINER";
        }
      }
      // Other Compressed
      else {
        detectedBitDepth = "COMPRESSED";
        isLossless = false;
      }

      const bitrate = Math.round((file.size * 8) / buffer.duration / 1000);

      const newMetadata: AudioMetadata = {
        fileName: file.name,
        fileSize: file.size,
        format: file.type || 'unknown',
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        detectedBitDepth: detectedBitDepth,
        bitrate: bitrate,
        isLossless
      };

      setMetadata(newMetadata);
      setStatus(AnalyzeStatus.COMPLETE);

    } catch (err) {
      console.error(err);
      setErrorMsg(t.error);
      setStatus(AnalyzeStatus.ERROR);
    }
  };

  const getBitDepthLabel = (val: string | number) => {
    if (typeof val === 'number') return `${val} ${t.bit}`;
    switch(val) {
      case 'FLOAT': return t.code_float;
      case 'VARIABLE': return t.code_variable;
      case 'COMPRESSED': return t.code_compressed;
      case 'M4A_CONTAINER': return t.code_m4a_container;
      case 'ALAC': return t.code_alac;
      case 'AAC': return t.code_aac;
      case 'M4A_UNKNOWN': return t.code_m4a_unknown;
      case 'UNKNOWN': return t.code_unknown;
      default: return val;
    }
  };

  const getChannelLabel = (ch: number) => {
    if (ch === 1) return t.mono;
    if (ch === 2) return t.stereo;
    return t.multi;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 relative">
      
      {/* Language Switcher */}
      <button 
        onClick={toggleLanguage}
        className="absolute top-6 right-6 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-indigo-500 hover:bg-gray-800 transition-colors text-sm font-medium text-gray-300"
      >
        <Globe className="w-4 h-4" />
        <span>{lang === 'ja' ? 'English' : '日本語'}</span>
      </button>

      <div className="w-full max-w-4xl space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-gray-900 rounded-xl mb-4 ring-1 ring-gray-800 shadow-lg shadow-indigo-500/10">
            <Activity className="w-8 h-8 text-indigo-500" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            AudioSpec <span className="text-indigo-500">Analyzer</span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            {t.subtitle}
          </p>
        </div>

        {/* Main Content */}
        <div className="bg-gray-900/50 backdrop-blur-sm rounded-3xl p-6 sm:p-8 border border-gray-800 shadow-2xl">
          <DropZone 
            onFileSelected={processFile} 
            isProcessing={status === AnalyzeStatus.PROCESSING}
            labels={{
              idle: t.dropIdle,
              processing: t.dropProcessing,
              supports: t.supports
            }}
          />

          {/* Error Message */}
          {status === AnalyzeStatus.ERROR && (
            <div className="mt-6 p-4 bg-red-900/20 border border-red-800 rounded-xl flex items-center gap-3 text-red-200">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{errorMsg || t.error}</p>
            </div>
          )}

          {/* Results Area */}
          {status === AnalyzeStatus.COMPLETE && metadata && (
            <div className="mt-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              
              {/* Waveform Visual */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-gray-400 uppercase tracking-wider font-semibold">
                  <span>{t.waveform}</span>
                  <span>{formatDuration(metadata.duration)}</span>
                </div>
                <Waveform audioBuffer={audioBuffer} />
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                
                {/* Sample Rate */}
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700/50 hover:border-indigo-500/50 transition-colors">
                  <div className="flex items-center gap-2 mb-2 text-indigo-400">
                    <Activity className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">{t.sampleRate}</span>
                  </div>
                  <div className="text-2xl font-mono font-bold text-white">
                    {metadata.sampleRate.toLocaleString()} <span className="text-sm text-gray-500 font-sans">Hz</span>
                  </div>
                </div>

                {/* Bit Depth */}
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700/50 hover:border-indigo-500/50 transition-colors relative overflow-hidden">
                  {metadata.isLossless && (
                     <div className="absolute top-0 right-0 p-1">
                       <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                     </div>
                  )}
                  <div className="flex items-center gap-2 mb-2 text-purple-400">
                    <Mic2 className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">{t.bitDepth}</span>
                  </div>
                  <div className="text-2xl font-mono font-bold text-white truncate text-ellipsis" title={String(getBitDepthLabel(metadata.detectedBitDepth))}>
                    {getBitDepthLabel(metadata.detectedBitDepth)}
                  </div>
                </div>

                {/* Channels */}
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700/50 hover:border-indigo-500/50 transition-colors">
                  <div className="flex items-center gap-2 mb-2 text-blue-400">
                    <Info className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">{t.channels}</span>
                  </div>
                  <div className="text-2xl font-mono font-bold text-white">
                    {metadata.channels} <span className="text-sm text-gray-500 font-sans">
                      ({getChannelLabel(metadata.channels)})
                    </span>
                  </div>
                </div>

                {/* Bitrate */}
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700/50 hover:border-indigo-500/50 transition-colors">
                  <div className="flex items-center gap-2 mb-2 text-emerald-400">
                    <FileAudio className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">{t.bitrate}</span>
                  </div>
                  <div className="text-2xl font-mono font-bold text-white">
                    {metadata.bitrate} <span className="text-sm text-gray-500 font-sans">{t.kbps}</span>
                  </div>
                </div>
              </div>

              {/* Detailed Metadata Table */}
              <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
                <div className="px-6 py-4 border-b border-gray-800 bg-gray-800/30 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-200">{t.fileMeta}</h3>
                </div>
                <div className="divide-y divide-gray-800">
                  <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-800/20">
                    <span className="text-sm text-gray-500">{t.fileName}</span>
                    <span className="text-sm font-mono text-gray-300 text-right truncate pl-4">{metadata.fileName}</span>
                  </div>
                  <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-800/20">
                    <span className="text-sm text-gray-500">{t.fileSize}</span>
                    <span className="text-sm font-mono text-gray-300 text-right">{formatBytes(metadata.fileSize)}</span>
                  </div>
                  <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-800/20">
                    <span className="text-sm text-gray-500">{t.mimeType}</span>
                    <span className="text-sm font-mono text-gray-300 text-right">{metadata.format}</span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-center text-gray-600 italic">
                {t.note}
              </p>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
