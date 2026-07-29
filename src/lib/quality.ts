/**
 * Quality policy.
 *
 * There are two very different consumers of the same published stream:
 *
 * - OBS, on the captain's laptop, which needs the best layer available because that
 *   frame goes on air.
 * - The other guests, who only need to see faces well enough to hold a conversation.
 *
 * Guests publish once, simulcast, in three layers. OBS subscribes to the top layer,
 * the in-room grid subscribes to the bottom one. That is the whole trick: a guest
 * uploads one stream regardless of how many people are in the room, and downloads
 * only thumbnails of everyone else.
 */

import { VideoQuality } from 'livekit-client';

/** What a given page wants out of a subscription. */
export type ViewContext = 'obs' | 'grid';

export interface SubscriptionQuality {
  /** Passed straight to RemoteTrackPublication.setVideoQuality. */
  quality: VideoQuality;
  /** Hint passed to setVideoDimensions so the SFU picks a sane layer. */
  dimensions: { width: number; height: number };
}

/** Height in pixels of each simulcast layer a guest publishes. */
export const SIMULCAST_LAYER_HEIGHTS = [180, 360, 720] as const;

/**
 * Pick what a page should ask the SFU for.
 *
 * OBS asks for HIGH at the full publish resolution. The grid asks for LOW at the
 * bottom simulcast layer, which is what actually saves each guest's downlink.
 */
export function subscriptionQualityFor(context: ViewContext): SubscriptionQuality {
  if (context === 'obs') {
    return { quality: VideoQuality.HIGH, dimensions: { width: 1280, height: 720 } };
  }
  return { quality: VideoQuality.LOW, dimensions: { width: 320, height: 180 } };
}

/**
 * Video capture and encoding defaults for a publishing guest.
 *
 * 720p30 rather than 1080p: guests are on home connections and the captain's OBS
 * canvas puts several of them on screen at once, so the extra pixels would cost
 * uplink that some guest cannot spare and buy resolution the layout never shows.
 * Raise `maxBitrate` here if a future show goes single-guest fullscreen.
 */
export const PUBLISH_VIDEO_PRESET = {
  resolution: { width: 1280, height: 720, frameRate: 30 },
  encoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
} as const;

/**
 * Audio capture defaults.
 *
 * This is a podcast, so audio is the part that must not be compromised: 48 kbps
 * mono Opus, RED enabled for packet-loss resilience, and DTX explicitly off because
 * discontinuous transmission clips the first syllable after a pause, which sounds
 * like a dropout in a recording.
 */
export const PUBLISH_AUDIO_PRESET = {
  maxBitrate: 48_000,
  dtx: false,
  red: true,
} as const;

/**
 * Browser-side capture constraints. All three are on because guests are on laptop
 * speakers as often as headphones and non-technical guests will not debug feedback.
 */
export const AUDIO_CAPTURE_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;
