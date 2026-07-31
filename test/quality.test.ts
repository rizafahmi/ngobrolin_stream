import { describe, expect, it } from 'vitest';
import { ScreenSharePresets, VideoQuality } from 'livekit-client';
import {
  PUBLISH_AUDIO_PRESET,
  PUBLISH_SCREEN_AUDIO_PRESET,
  PUBLISH_SCREEN_PRESET,
  PUBLISH_VIDEO_PRESET,
  SCREEN_SIMULCAST_LAYER_HEIGHTS,
  SIMULCAST_LAYER_HEIGHTS,
  screenSubscriptionQualityFor,
  slotSubscriptionQualityFor,
  subscriptionQualityFor,
} from '../src/lib/quality.ts';

describe('subscriptionQualityFor', () => {
  it('gives OBS the top simulcast layer, because that frame goes on air', () => {
    const obs = subscriptionQualityFor('obs');
    expect(obs.quality).toBe(VideoQuality.HIGH);
    expect(obs.dimensions.height).toBe(PUBLISH_VIDEO_PRESET.resolution.height);
  });

  it('gives the in-room grid the bottom layer, because it is only for conversation', () => {
    const grid = subscriptionQualityFor('grid');
    expect(grid.quality).toBe(VideoQuality.LOW);
    expect(grid.dimensions.height).toBe(SIMULCAST_LAYER_HEIGHTS[0]);
  });

  it('asks the grid for materially less than OBS, which is the whole point', () => {
    const obs = subscriptionQualityFor('obs');
    const grid = subscriptionQualityFor('grid');
    const pixels = (d: { width: number; height: number }) => d.width * d.height;
    expect(pixels(grid.dimensions) * 8).toBeLessThan(pixels(obs.dimensions));
  });

  it('requests dimensions that match a layer the publisher actually sends', () => {
    for (const context of ['obs', 'grid'] as const) {
      const { dimensions } = subscriptionQualityFor(context);
      expect(SIMULCAST_LAYER_HEIGHTS).toContain(dimensions.height);
    }
  });
});

describe('publish presets', () => {
  it('publishes 720p, the top layer OBS subscribes to', () => {
    expect(PUBLISH_VIDEO_PRESET.resolution.height).toBe(720);
    expect(SIMULCAST_LAYER_HEIGHTS.at(-1)).toBe(720);
  });

  it('keeps DTX off so speech onsets are not clipped in the recording', () => {
    expect(PUBLISH_AUDIO_PRESET.dtx).toBe(false);
    expect(PUBLISH_AUDIO_PRESET.red).toBe(true);
  });
});

describe('screen share encoding policy', () => {
  it('takes its numbers from livekit’s own screen-share presets, not invented ones', () => {
    expect(PUBLISH_SCREEN_PRESET.top).toBe(ScreenSharePresets.h720fps15);
    expect(PUBLISH_SCREEN_PRESET.low).toBe(ScreenSharePresets.h360fps15);
  });

  /**
   * 720p, not the 1080p this used to publish.
   *
   * The composed stage renders the screen around 1500px wide rather than filling a
   * 1920 frame, so the 1080p source was being downscaled on the way to air anyway. It
   * also cuts the sharing guest's uplink from about 2.9 to 1.9 Mbps on top of their
   * camera, and it is what makes handing every other guest a sharp copy affordable.
   */
  it('publishes the screen at 720p, the width the composed stage actually renders', () => {
    expect(PUBLISH_SCREEN_PRESET.resolution).toMatchObject({ width: 1280, height: 720 });
    expect(PUBLISH_SCREEN_PRESET.top.encoding.maxBitrate).toBe(1_500_000);
  });

  it('still trades frame rate for legibility, because a screen is text and a face is motion', () => {
    expect(PUBLISH_SCREEN_PRESET.top.encoding.maxFramerate).toBeLessThan(
      PUBLISH_VIDEO_PRESET.encoding.maxFramerate,
    );
    // Same pixels as a face now, at 40% of the bits, spent on half as many frames.
    expect(PUBLISH_SCREEN_PRESET.top.encoding.maxBitrate).toBeLessThan(
      PUBLISH_VIDEO_PRESET.encoding.maxBitrate,
    );
  });

  it('hints the encoder at detail, so text is not smeared as if it were motion', () => {
    expect(PUBLISH_SCREEN_PRESET.contentHint).toBe('detail');
  });

  it('publishes two layers and no middle one, since only OBS and the grid subscribe', () => {
    expect(PUBLISH_SCREEN_PRESET.simulcast).toBe(true);
    expect(SCREEN_SIMULCAST_LAYER_HEIGHTS).toHaveLength(2);
    expect(SCREEN_SIMULCAST_LAYER_HEIGHTS).toEqual([360, 720]);
    // Three layers is the camera ladder. A middle screen layer would be encoded for
    // nobody, since every subscriber is either a stage-sized or a thumbnail-sized box.
    expect(SCREEN_SIMULCAST_LAYER_HEIGHTS.length).toBeLessThan(SIMULCAST_LAYER_HEIGHTS.length);
  });

  it('keeps the screen audio policy identical to the microphone policy', () => {
    expect(PUBLISH_SCREEN_AUDIO_PRESET.maxBitrate).toBe(PUBLISH_AUDIO_PRESET.maxBitrate);
    expect(PUBLISH_SCREEN_AUDIO_PRESET.dtx).toBe(false);
    expect(PUBLISH_SCREEN_AUDIO_PRESET.red).toBe(true);
  });

  it('leaves the browser processing off screen audio, which is a clip and not a voice', () => {
    expect(PUBLISH_SCREEN_AUDIO_PRESET.capture.echoCancellation).toBe(false);
    expect(PUBLISH_SCREEN_AUDIO_PRESET.capture.noiseSuppression).toBe(false);
    expect(PUBLISH_SCREEN_AUDIO_PRESET.capture.autoGainControl).toBe(false);
  });

  it('stops the shared audio coming out of the sharer’s own speakers', () => {
    // The one feedback path the site can close by itself: the sharer's speakers into
    // the sharer's microphone. Everything else is a headphone question.
    //
    // It lives in the capture constraints, not beside the video policy, because
    // livekit-client accepts a top-level `suppressLocalAudioPlayback` and then never
    // forwards it to getDisplayMedia. Asserting the working location is the point.
    expect(PUBLISH_SCREEN_AUDIO_PRESET.capture.suppressLocalAudioPlayback).toBe(true);
    expect(PUBLISH_SCREEN_PRESET).not.toHaveProperty('suppressLocalAudioPlayback');
  });

  it('does not touch the camera policy', () => {
    expect(PUBLISH_VIDEO_PRESET.resolution).toEqual({ width: 1280, height: 720, frameRate: 30 });
    expect(PUBLISH_VIDEO_PRESET.encoding).toEqual({ maxBitrate: 2_500_000, maxFramerate: 30 });
    expect(SIMULCAST_LAYER_HEIGHTS).toEqual([180, 360, 720]);
  });
});

describe('screenSubscriptionQualityFor', () => {
  it('gives OBS the full screen, because that frame goes on air', () => {
    const obs = screenSubscriptionQualityFor('obs');
    expect(obs.quality).toBe(VideoQuality.HIGH);
    expect(obs.dimensions).toEqual({ width: 1280, height: 720 });
    expect(obs.dimensions.height).toBe(PUBLISH_SCREEN_PRESET.resolution.height);
  });

  it('gives the in-room grid the bottom layer, the same bargain as the camera tiles', () => {
    const grid = screenSubscriptionQualityFor('grid');
    expect(grid.quality).toBe(VideoQuality.LOW);
    expect(grid.dimensions).toEqual({ width: 640, height: 360 });
    expect(grid.dimensions.height).toBe(SCREEN_SIMULCAST_LAYER_HEIGHTS[0]);
  });

  it('requests dimensions that match a layer the publisher actually sends', () => {
    for (const context of ['obs', 'grid'] as const) {
      const { dimensions } = screenSubscriptionQualityFor(context);
      expect(SCREEN_SIMULCAST_LAYER_HEIGHTS).toContain(dimensions.height);
    }
  });

  it('asks the grid for materially less than OBS, which is what keeps a share affordable', () => {
    const pixels = (d: { width: number; height: number }) => d.width * d.height;
    expect(pixels(screenSubscriptionQualityFor('grid').dimensions) * 4).toBeLessThanOrEqual(
      pixels(screenSubscriptionQualityFor('obs').dimensions),
    );
    // The ratio that actually reaches the bandwidth meter, which is steeper than the
    // pixel count: a quarter of the pixels costs about a quarter of the bits.
    expect(PUBLISH_SCREEN_PRESET.low.encoding.maxBitrate * 3).toBeLessThan(
      PUBLISH_SCREEN_PRESET.top.encoding.maxBitrate,
    );
  });

  it('asks the guests for more of a screen than of a face', () => {
    // A shared screen is the one thing where legibility beats smoothness, so at the
    // guest end it is deliberately the more expensive subscription of the two. At the
    // OBS end the two are now the same size: the screen dropped to 720p because the
    // composed stage renders it around 1500px, not across a whole 1920 frame.
    expect(screenSubscriptionQualityFor('grid').dimensions.height).toBeGreaterThan(
      subscriptionQualityFor('grid').dimensions.height,
    );
    expect(screenSubscriptionQualityFor('obs').dimensions).toEqual(
      subscriptionQualityFor('obs').dimensions,
    );
  });
});

/**
 * Quality by slot, which is the substantive half of the presentation layer.
 *
 * Before it, quality was a property of the *page*: OBS took the top layer, a guest took
 * the bottom one. That is no longer enough, because the same track can be a 1500px
 * stage or a 360px thumbnail depending on who is sharing, and the answer has to follow
 * the track between them. Getting it wrong is silent in both directions: too low and
 * the thing the feature exists to make readable stays blurry, too high and the
 * bandwidth saving that makes the free plan fit quietly disappears.
 */
describe('slotSubscriptionQualityFor', () => {
  it('gives the on-stage screen the top layer in both renders', () => {
    for (const mode of ['obs', 'app'] as const) {
      const q = slotSubscriptionQualityFor(mode, 'stage', 'screen');
      expect(q.quality, mode).toBe(VideoQuality.HIGH);
      expect(q.dimensions, mode).toEqual({ width: 1280, height: 720 });
    }
  });

  it('is the entire fix for the blindness: a guest sees the stage sharp, not as a thumbnail', () => {
    expect(slotSubscriptionQualityFor('app', 'stage', 'screen').dimensions.height).toBeGreaterThan(
      slotSubscriptionQualityFor('app', 'filmstrip', 'screen').dimensions.height,
    );
    expect(slotSubscriptionQualityFor('app', 'stage', 'screen').dimensions.height).toBe(
      SCREEN_SIMULCAST_LAYER_HEIGHTS.at(-1),
    );
  });

  it('does not blanket-subscribe the composed OBS render at the top layer', () => {
    const filmstrip = slotSubscriptionQualityFor('obs', 'filmstrip', 'camera');
    expect(filmstrip.quality).toBe(VideoQuality.MEDIUM);
    expect(filmstrip.dimensions).toEqual({ width: 640, height: 360 });
  });

  it('feeds every composed face the 360p layer, which is the size it actually renders', () => {
    // A filmstrip face is 360px wide and an even-grid face on the 1920x1080 canvas is
    // capped at 640px, so 640x360 covers both. Subscribing those at 720p would be a
    // second full copy of every camera on top of the per-guest sources.
    for (const slot of ['even', 'filmstrip'] as const) {
      expect(slotSubscriptionQualityFor('obs', slot, 'camera').dimensions, slot).toEqual({
        width: 640,
        height: 360,
      });
    }
  });

  it('keeps the guests on the bottom layer for faces, sharing or not', () => {
    for (const slot of ['even', 'filmstrip'] as const) {
      const q = slotSubscriptionQualityFor('app', slot, 'camera');
      expect(q.quality, slot).toBe(VideoQuality.LOW);
      expect(q.dimensions, slot).toEqual({ width: 320, height: 180 });
    }
  });

  it('agrees with the page-level policy it grew out of, so the two cannot drift', () => {
    expect(slotSubscriptionQualityFor('app', 'even', 'camera')).toEqual(subscriptionQualityFor('grid'));
    expect(slotSubscriptionQualityFor('app', 'filmstrip', 'screen')).toEqual(
      screenSubscriptionQualityFor('grid'),
    );
    expect(slotSubscriptionQualityFor('obs', 'stage', 'screen')).toEqual(
      screenSubscriptionQualityFor('obs'),
    );
  });

  it('only ever asks for a layer the publisher actually sends', () => {
    for (const mode of ['obs', 'app'] as const) {
      for (const slot of ['stage', 'filmstrip', 'even'] as const) {
        expect(SIMULCAST_LAYER_HEIGHTS, `${mode}/${slot}`).toContain(
          slotSubscriptionQualityFor(mode, slot, 'camera').dimensions.height,
        );
        expect(SCREEN_SIMULCAST_LAYER_HEIGHTS, `${mode}/${slot}`).toContain(
          slotSubscriptionQualityFor(mode, slot, 'screen').dimensions.height,
        );
      }
    }
  });

  it('never asks a guest for more than it asks OBS for', () => {
    const pixels = (d: { width: number; height: number }) => d.width * d.height;
    for (const slot of ['stage', 'filmstrip', 'even'] as const) {
      for (const kind of ['camera', 'screen'] as const) {
        expect(
          pixels(slotSubscriptionQualityFor('app', slot, kind).dimensions),
          `${slot}/${kind}`,
        ).toBeLessThanOrEqual(pixels(slotSubscriptionQualityFor('obs', slot, kind).dimensions));
      }
    }
  });
});
