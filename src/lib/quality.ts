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

import { ScreenSharePresets, VideoQuality } from 'livekit-client';

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

/**
 * Screen share: a different picture, and therefore a different policy.
 *
 * Everything above is tuned for a talking head, where motion is the signal and a
 * smeared letter costs nothing. A shared screen is the opposite: it is mostly static,
 * and the only thing that matters is whether the captain's audience can read it. So
 * the trade runs the other way - more pixels, fewer frames.
 *
 * The numbers come from livekit's own `ScreenSharePresets` rather than being invented
 * here, and both chosen presets carry livekit's `medium` encoding priority.
 *
 * - **1920x1080 at 15 fps, 2.5 Mbps** for the layer OBS takes. 1080p because a 720p
 *   capture of a 1440p laptop display loses small text outright, and 15 fps because a
 *   slide or an editor changes a few times a minute; spending the same 2.5 Mbps on 30
 *   fps would halve the bits available per frame for no visible gain.
 * - **640x360 at 15 fps, 400 kbps** for the layer the in-room grid takes. A grid tile
 *   is about 450 px wide during a three-guest show, so this is already more pixels
 *   than the tile can show.
 *
 * **Two layers, not three.** The camera ladder has a middle 360p layer because a
 * guest's tile can be any size. A screen has exactly two consumers, at the two ends of
 * the ladder, so a middle layer would be encoded for nobody and would take its
 * bitrate from the layer that goes on air. Simulcast itself stays on, though: without
 * it the grid would have to subscribe to the same 2.5 Mbps stream OBS takes, and one
 * leg per guest at that rate is what turns a screen share into a bandwidth problem.
 * See the screen-share cost table in README.
 *
 * `contentHint: 'detail'` tells the encoder this is text and UI, not video, so it
 * keeps edges sharp and drops frames instead of resolution when constrained. livekit
 * already defaults a screen-share track's `degradationPreference` to
 * `maintain-resolution`, which is the same instinct, so that is left alone.
 *
 * `suppressLocalAudioPlayback` stops a shared tab's audio coming out of the sharer's
 * own speakers. That is the one feedback path this site can close by itself: without
 * it the sharer's microphone re-captures the clip and the captain gets it twice.
 */
export const PUBLISH_SCREEN_PRESET = {
  top: ScreenSharePresets.h1080fps15,
  low: ScreenSharePresets.h360fps15,
  resolution: ScreenSharePresets.h1080fps15.resolution,
  contentHint: 'detail',
  simulcast: true,
  suppressLocalAudioPlayback: true,
} as const;

/** Height in pixels of each layer a shared screen is published in. Low first. */
export const SCREEN_SIMULCAST_LAYER_HEIGHTS = [
  ScreenSharePresets.h360fps15.height,
  ScreenSharePresets.h1080fps15.height,
] as const;

/**
 * Screen-share audio: captured, and encoded exactly like a microphone.
 *
 * Capturing it is a deliberate yes. Playing a clip on air is a real part of the show,
 * and routing that audio through the site means the captain gets it as a clean digital
 * copy in its own OBS source rather than as whatever the sharer's microphone picked up
 * off their speakers.
 *
 * The bitrate and codec settings match {@link PUBLISH_AUDIO_PRESET} deliberately: this
 * is one show with one audio quality bar, and the content is overwhelmingly speech.
 * Raise `maxBitrate` here (livekit's `AudioPresets.musicHighQualityStereo` is 128 kbps)
 * if a future episode is built around music.
 *
 * The browser's three voice processors are all off, though, where the microphone has
 * all three on. Noise suppression and auto gain are trained on speech and audibly
 * mangle music, and there is no echo to cancel: this audio never went through a room.
 */
export const PUBLISH_SCREEN_AUDIO_PRESET = {
  maxBitrate: PUBLISH_AUDIO_PRESET.maxBitrate,
  dtx: false,
  red: true,
  capture: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
} as const;

/**
 * Pick what a page should ask the SFU for from a *shared screen*.
 *
 * Same bargain as {@link subscriptionQualityFor}, one rung higher at both ends,
 * because legibility is the whole point of the track.
 */
export function screenSubscriptionQualityFor(context: ViewContext): SubscriptionQuality {
  const preset = context === 'obs' ? PUBLISH_SCREEN_PRESET.top : PUBLISH_SCREEN_PRESET.low;
  return {
    quality: context === 'obs' ? VideoQuality.HIGH : VideoQuality.LOW,
    dimensions: { width: preset.width, height: preset.height },
  };
}
