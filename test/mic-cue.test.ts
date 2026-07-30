import { describe, expect, it } from 'vitest';
import {
  MIC_LEVEL_GAIN,
  micCue,
  micLevelPercent,
  peakAmplitude,
} from '../src/lib/mic-cue.ts';

describe('peakAmplitude', () => {
  it('reads silence off a time-domain buffer as zero', () => {
    expect(peakAmplitude(new Uint8Array([128, 128, 128, 128]))).toBe(0);
  });

  it('reads full scale as one, in both directions', () => {
    expect(peakAmplitude(new Uint8Array([255]))).toBeCloseTo(0.992, 3);
    expect(peakAmplitude(new Uint8Array([0]))).toBe(1);
  });

  it('takes the peak of the buffer, not the last sample', () => {
    expect(peakAmplitude(new Uint8Array([128, 192, 128]))).toBeCloseTo(0.5, 5);
  });

  it('treats an empty buffer as silence rather than -Infinity', () => {
    expect(peakAmplitude(new Uint8Array([]))).toBe(0);
  });
});

describe('micLevelPercent', () => {
  it('maps silence to an empty bar', () => {
    expect(micLevelPercent(0)).toBe(0);
  });

  it('scales speech up, because speech peaks well below full scale', () => {
    expect(micLevelPercent(0.1)).toBe(Math.round(0.1 * MIC_LEVEL_GAIN));
  });

  it('clamps at a full bar rather than overflowing its track', () => {
    expect(micLevelPercent(1)).toBe(100);
    expect(micLevelPercent(100)).toBe(100);
  });

  it('saturates exactly at the gain boundary and just below it', () => {
    expect(micLevelPercent(1 / MIC_LEVEL_GAIN)).toBe(1);
    expect(micLevelPercent(100 / MIC_LEVEL_GAIN)).toBe(100);
    expect(micLevelPercent(99.4 / MIC_LEVEL_GAIN)).toBe(99);
  });

  it('never returns a negative width for a nonsense reading', () => {
    expect(micLevelPercent(-1)).toBe(0);
    expect(micLevelPercent(Number.NaN)).toBe(0);
  });
});

describe('micCue', () => {
  it('shows the speaking cue and a live level when an unmuted guest talks', () => {
    expect(micCue({ muted: false, speaking: true, level: 0.2 })).toEqual({
      speaking: true,
      levelPercent: micLevelPercent(0.2),
    });
  });

  it('shows no speaking cue while an unmuted guest is quiet', () => {
    expect(micCue({ muted: false, speaking: false, level: 0 })).toEqual({
      speaking: false,
      levelPercent: 0,
    });
  });

  it('lets muted win over a library that still reports speaking', () => {
    // The failure this whole feature exists to prevent: someone believing they are
    // heard while muted. Muted suppresses the cue no matter what anything reports.
    expect(micCue({ muted: true, speaking: true, level: 0.9 })).toEqual({
      speaking: false,
      levelPercent: 0,
    });
  });

  it('lets muted win over a live analyser reading too', () => {
    // A muted LiveKit track stops the sender, but a local analyser attached to the
    // same MediaStreamTrack can still be running. It must not paint a level.
    expect(micCue({ muted: true, speaking: false, level: 0.5 }).levelPercent).toBe(0);
  });

  it('treats a participant with no microphone at all as muted', () => {
    expect(micCue({ muted: true, speaking: true, level: 1 }).speaking).toBe(false);
  });
});
