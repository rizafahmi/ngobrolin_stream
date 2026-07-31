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
import type { CellKind, RenderMode, StageSlot } from './stage.ts';

/**
 * What a given page wants out of a subscription.
 *
 * The same two consumers `RenderMode` in `stage.ts` names, with `grid` where that says
 * `app`. The older name is kept because it is what the per-guest OBS pages have always
 * used and it reads correctly there; the composition needed a word that could not be
 * confused with the *even grid* slot, which is a different thing entirely.
 */
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
 * - **1280x720 at 15 fps, 1.5 Mbps** for the layer that goes on stage. 15 fps because a
 *   slide or an editor changes a few times a minute; spending the same bits on 30 fps
 *   would halve what is available per frame for no visible gain.
 * - **640x360 at 15 fps, 400 kbps** for the layer a filmstrip cell takes. That cell is
 *   360 px wide, so this is already more pixels than it can show.
 *
 * **720p, where this used to publish 1080p.** Three reasons, and the first is the one
 * that matters: the composed stage renders the screen around 1500 px wide rather than
 * across a whole 1920 frame, so the extra pixels were being thrown away on the way to
 * air. It also cuts the sharing guest's uplink from about 2.9 to 1.9 Mbps on top of
 * their camera, on a home connection. And it is what makes the real fix affordable at
 * all: handing every *other* guest a sharp copy of the stage costs 1.5 Mbps a leg
 * instead of 2.5, which is the difference between the free plan fitting and not.
 *
 * **Two layers, not three.** The camera ladder has a middle 360p layer because a
 * guest's tile can be any size. A screen has exactly two sizes - on stage, or a
 * filmstrip cell - so a middle layer would be encoded for nobody and would take its
 * bitrate from the layer that goes on air. Simulcast itself stays on, though: without
 * it every filmstrip cell would have to subscribe to the full stage copy, and one leg
 * per guest at that rate is what turns a screen share into a bandwidth problem.
 * See the screen-share cost table in README.
 *
 * `contentHint: 'detail'` tells the encoder this is text and UI, not video, so it
 * keeps edges sharp and drops frames instead of resolution when constrained. livekit
 * already defaults a screen-share track's `degradationPreference` to
 * `maintain-resolution`, which is the same instinct, so that is left alone.
 *
 * The feedback mitigation lives in {@link PUBLISH_SCREEN_AUDIO_PRESET} rather than
 * here, for a reason worth knowing: see the note on `suppressLocalAudioPlayback`.
 */
export const PUBLISH_SCREEN_PRESET = {
  top: ScreenSharePresets.h720fps15,
  low: ScreenSharePresets.h360fps15,
  resolution: ScreenSharePresets.h720fps15.resolution,
  contentHint: 'detail',
  simulcast: true,
} as const;

/** Height in pixels of each layer a shared screen is published in. Low first. */
export const SCREEN_SIMULCAST_LAYER_HEIGHTS = [
  ScreenSharePresets.h360fps15.height,
  ScreenSharePresets.h720fps15.height,
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
 *
 * `suppressLocalAudioPlayback` is the feedback mitigation, and it belongs in these
 * capture constraints rather than alongside the video policy. livekit-client accepts a
 * top-level `suppressLocalAudioPlayback` in its screen-capture options and then does
 * not forward it to `getDisplayMedia` (see `screenCaptureToDisplayMediaStreamOptions`
 * in the client), so setting it there looks right and does nothing. It is a
 * constrainable property of the captured audio track, so the constraints are where it
 * actually reaches the browser.
 *
 * What it buys: a shared tab's audio stops coming out of the sharer's own speakers, so
 * their microphone cannot re-capture the clip and hand the captain a second, delayed
 * copy of it. That is the only feedback path this site can close by itself. The
 * remaining one - a guest hearing the clip through their speakers - is the same
 * headphones question the show already has for every other guest's voice, and every
 * guest's microphone already runs with echo cancellation on.
 */
export const PUBLISH_SCREEN_AUDIO_PRESET = {
  maxBitrate: PUBLISH_AUDIO_PRESET.maxBitrate,
  dtx: false,
  red: true,
  capture: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    suppressLocalAudioPlayback: true,
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

/**
 * Pick what a page should ask the SFU for, given **where the track is being drawn**.
 *
 * This is the presentation layer's substantive engineering, and it is a strictly
 * stronger rule than the two functions above. Those answer "which page is this?", which
 * was enough while every page drew every track at one size. It is not enough now: the
 * same screen track is a 1500 px stage on one render and a 360 px filmstrip cell on
 * another, and it moves between the two whenever somebody starts or stops sharing.
 *
 * Both directions of getting it wrong are silent:
 *
 * - Too low on the stage and the picture stays blurry, which is the exact blindness
 *   this feature was built to fix.
 * - Too high in the filmstrip and the bandwidth saving quietly disappears, which shows
 *   up a month later as a LiveKit meter past its allowance mid-recording.
 *
 * So the mapping must be **re-applied when the composition changes**, not once when a
 * track is subscribed. See `applyCompositionQuality` in the two page controllers.
 *
 * The table, and why each cell is what it is:
 *
 * | | on stage | filmstrip | even grid |
 * | --- | --- | --- | --- |
 * | OBS screen | 720p top layer, it is the picture | 360p, it is a thumbnail | n/a |
 * | OBS face | 720p, only if a face ever goes on stage | 360p, 360 px wide | 360p, capped at 640 px |
 * | guest screen | 720p top layer - *this is the fix* | 360p | n/a |
 * | guest face | 720p | 180p bottom layer | 180p, exactly as today |
 *
 * The one entry worth defending is **OBS faces in the even grid at 360p**. The composed
 * canvas caps an even-grid cell at 640 px (`OBS_GRID_MAX_TILE_WIDTH`), which the 360p
 * layer covers at every plausible room size, and the alternative is a second full copy
 * of every camera on top of the per-guest sources the captain still runs for audio. A
 * guest who genuinely needs the whole 1920 frame is what the per-guest source is for.
 */
export function slotSubscriptionQualityFor(
  mode: RenderMode,
  slot: StageSlot,
  kind: CellKind,
): SubscriptionQuality {
  const screen = kind === 'screen';

  if (slot === 'stage') {
    return screen ? screenSubscriptionQualityFor('obs') : subscriptionQualityFor('obs');
  }
  if (screen) {
    return screenSubscriptionQualityFor('grid');
  }
  if (mode === 'app') {
    return subscriptionQualityFor('grid');
  }
  return {
    quality: VideoQuality.MEDIUM,
    dimensions: { width: 640, height: SIMULCAST_LAYER_HEIGHTS[1] },
  };
}
