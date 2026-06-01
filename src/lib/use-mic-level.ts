"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to the input level of a MediaStream and return a value in
 * [0, 1] roughly corresponding to RMS amplitude. Updates ~60×/s via
 * requestAnimationFrame. Cleans up the AudioContext on unmount or when
 * the stream changes.
 */
export function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || typeof window === "undefined") return;

    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtxClass) return;

    const ctx = new AudioCtxClass();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let mounted = true;

    const loop = () => {
      if (!mounted) return;
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      // Compress the dynamic range a bit — typical speech is around
      // 0.05-0.2 RMS, so we scale up to make the meter feel responsive.
      const normalized = Math.min(1, rms * 2.5);
      setLevel(normalized);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      try {
        source.disconnect();
      } catch {
        // ignore
      }
      void ctx.close();
    };
  }, [stream]);

  return level;
}
