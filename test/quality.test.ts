import { describe, expect, it } from 'vitest';
import { VideoQuality } from 'livekit-client';
import {
  PUBLISH_AUDIO_PRESET,
  PUBLISH_VIDEO_PRESET,
  SIMULCAST_LAYER_HEIGHTS,
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
