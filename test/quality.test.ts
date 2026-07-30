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
    expect(PUBLISH_SCREEN_PRESET.top).toBe(ScreenSharePresets.h1080fps15);
    expect(PUBLISH_SCREEN_PRESET.low).toBe(ScreenSharePresets.h360fps15);
  });

  it('trades frame rate for pixels, because a screen is text and a face is motion', () => {
    expect(PUBLISH_SCREEN_PRESET.top.encoding.maxFramerate).toBeLessThan(
      PUBLISH_VIDEO_PRESET.encoding.maxFramerate,
    );
    expect(PUBLISH_SCREEN_PRESET.resolution.height).toBeGreaterThan(
      PUBLISH_VIDEO_PRESET.resolution.height,
    );
  });

  it('hints the encoder at detail, so text is not smeared as if it were motion', () => {
    expect(PUBLISH_SCREEN_PRESET.contentHint).toBe('detail');
  });

  it('publishes two layers and no middle one, since only OBS and the grid subscribe', () => {
    expect(PUBLISH_SCREEN_PRESET.simulcast).toBe(true);
    expect(SCREEN_SIMULCAST_LAYER_HEIGHTS).toHaveLength(2);
    expect(SCREEN_SIMULCAST_LAYER_HEIGHTS).toEqual([360, 1080]);
    // Three layers is the camera ladder. A middle screen layer would be encoded for
    // nobody, since every subscriber is either OBS or a thumbnail-sized grid tile.
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
    expect(obs.dimensions).toEqual({ width: 1920, height: 1080 });
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
    expect(pixels(screenSubscriptionQualityFor('grid').dimensions) * 8).toBeLessThan(
      pixels(screenSubscriptionQualityFor('obs').dimensions),
    );
  });

  it('asks for more of a screen than of a face, at both ends', () => {
    // A shared screen is the one thing on air where legibility beats smoothness, so it
    // is deliberately the more expensive subscription of the two.
    expect(screenSubscriptionQualityFor('obs').dimensions.height).toBeGreaterThan(
      subscriptionQualityFor('obs').dimensions.height,
    );
    expect(screenSubscriptionQualityFor('grid').dimensions.height).toBeGreaterThan(
      subscriptionQualityFor('grid').dimensions.height,
    );
  });
});
