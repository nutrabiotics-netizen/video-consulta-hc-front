/**
 * Captura audio del micrófono, convierte a PCM 16-bit mono 16 kHz
 * y envía chunks por WebSocket para Transcribe Streaming.
 */

import { useCallback, useRef, useState } from 'react';

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_MS = 120;
const SAMPLES_PER_CHUNK = Math.floor((TARGET_SAMPLE_RATE * CHUNK_MS) / 1000);

type SendFn = (type: string, payload?: object) => void;

function resampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const j = Math.floor(srcIndex);
    const frac = srcIndex - j;
    out[i] = input[j] ?? 0;
    if (frac > 0 && j + 1 < input.length) {
      out[i] = out[i] * (1 - frac) + (input[j + 1] ?? 0) * frac;
    }
  }
  return out;
}

function floatToPcm16(float32: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    const v = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, v, true);
  }
  return new Uint8Array(buf);
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useLiveTranscription(send: SendFn, participant: string) {
  const [isActive, setIsActive] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const bufferRef = useRef<number[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const flushBuffer = useCallback(() => {
    if (bufferRef.current.length < SAMPLES_PER_CHUNK) return;
    const samples = bufferRef.current.splice(0, SAMPLES_PER_CHUNK);
    const float32 = new Float32Array(samples);
    const pcm = floatToPcm16(float32);
    const base64 = arrayBufferToBase64(pcm);
    send('audio_chunk', { data: base64 });
  }, [send]);

  const start = useCallback(async () => {
    if (isActive) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const bufferSize = 2048;
      const processor = context.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const resampled = resampleTo16k(input, context.sampleRate);
        bufferRef.current.push(...resampled);
      };

      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);

      send('audio_stream_start', { participant });
      setIsActive(true);
      intervalRef.current = setInterval(flushBuffer, CHUNK_MS);
    } catch (err) {
      console.error('useLiveTranscription start:', err);
    }
  }, [isActive, send, flushBuffer]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    send('audio_stream_end', {});
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (_) {}
      processorRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close().catch(() => {});
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    bufferRef.current = [];
    setIsActive(false);
  }, [send]);

  return { start, stop, isActive };
}
