/**
 * Microphone cue policy.
 *
 * A guest mid-recording has one anxious question: "can they hear me?". The join card
 * answers it before joining with a level bar; these helpers are what answer it inside
 * the room, on the tiles.
 *
 * Two separate facts are computed here and must not be collapsed:
 *
 * - `speaking`  - is this person talking right now. For remote participants this comes
 *                 from LiveKit (`ActiveSpeakersChanged` / `isSpeaking`); running an
 *                 analyser on somebody else's track is not affordable and not needed.
 * - `levelPercent` - how loud the local guest's own captured audio is, measured from
 *                 their own `LocalAudioTrack` by an analyser. Only the local tile shows
 *                 it, because only the local guest's own capture can be measured.
 *
 * Muted always wins over both. A muted guest who sees a speaking cue would believe
 * they are being heard when they are not, which is worse than showing nothing at all.
 */

/**
 * How much the raw peak amplitude is scaled before it fills the bar.
 *
 * Speech peaks well below full scale, so an unscaled bar barely moves and reads as a
 * dead microphone. This is a "your mic is alive" signal, not a calibrated meter.
 */
export const MIC_LEVEL_GAIN = 220;

export interface MicCueInput {
  /** True when the microphone publication is muted, or absent entirely. */
  muted: boolean;
  /** Whatever the source of truth for "is talking" reports for this participant. */
  speaking: boolean;
  /** Raw peak amplitude in 0..1. Ignored for muted participants. */
  level: number;
}

export interface MicCue {
  /** Drives the speaking outline on the tile. */
  speaking: boolean;
  /** Width of the tile's level bar, 0..100. */
  levelPercent: number;
}

/**
 * Peak deviation from silence in a time-domain analyser buffer, as 0..1.
 *
 * `getByteTimeDomainData` centres silence on 128, so distance from 128 is the signal.
 * An empty buffer is silence, not `-Infinity`.
 */
export function peakAmplitude(samples: Uint8Array): number {
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample - 128) / 128);
  }
  return peak;
}

/** Raw peak amplitude to a bar width in percent, scaled and clamped to 0..100. */
export function micLevelPercent(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(100, Math.round(level * MIC_LEVEL_GAIN));
}

/** The two cue facts for one tile, with muted suppressing both. */
export function micCue({ muted, speaking, level }: MicCueInput): MicCue {
  if (muted) return { speaking: false, levelPercent: 0 };
  return { speaking, levelPercent: micLevelPercent(level) };
}
