/**
 * The rule that keeps a screen share out of a camera source.
 *
 * This is the regression test for a bug that shipped: the OBS view page attached any
 * video track belonging to its target participant, so the moment a guest shared a
 * screen it replaced their face in the captain's source, silently, mid-broadcast.
 *
 * `viewAcceptsTrackSource` is deliberately free of any livekit-client import so it can
 * also be used from Node, and the tests below pin its string literals against the real
 * `Track.Source` enum so the two cannot drift apart.
 */
import { describe, expect, it } from 'vitest';
import { Track } from 'livekit-client';
import {
  SCREEN_VIEW_SOURCE,
  VIEW_SOURCE_PARAM,
  parseViewSource,
  viewAcceptsTrackSource,
  type ViewSource,
} from '../src/lib/view-source.ts';

describe('parseViewSource', () => {
  it('defaults to the camera when the parameter is absent, which is every saved OBS scene', () => {
    expect(parseViewSource(null)).toBe('camera');
    expect(parseViewSource(undefined)).toBe('camera');
    expect(parseViewSource('')).toBe('camera');
  });

  it('reads the screen source', () => {
    expect(parseViewSource('screen')).toBe('screen');
    expect(parseViewSource(SCREEN_VIEW_SOURCE)).toBe('screen');
  });

  it('accepts an explicit camera, so both URLs can be written out longhand', () => {
    expect(parseViewSource('camera')).toBe('camera');
  });

  it('tolerates whitespace and case, because these get pasted and hand-edited', () => {
    expect(parseViewSource('  screen ')).toBe('screen');
    expect(parseViewSource('SCREEN')).toBe('screen');
    expect(parseViewSource('Camera')).toBe('camera');
  });

  it('falls back to the camera on anything it does not recognise', () => {
    // One rule, no special case: anything that is not exactly `screen` is a camera
    // source. A typo therefore shows the face rather than a page that renders nothing.
    expect(parseViewSource('sceen')).toBe('camera');
    expect(parseViewSource('screen_share')).toBe('camera');
    expect(parseViewSource('1')).toBe('camera');
  });

  it('names the query parameter once, so the URL builder and the page agree', () => {
    expect(VIEW_SOURCE_PARAM).toBe('source');
  });
});

describe('viewAcceptsTrackSource', () => {
  it('lets a camera source render only the camera and the microphone', () => {
    expect(viewAcceptsTrackSource('camera', Track.Source.Camera)).toBe(true);
    expect(viewAcceptsTrackSource('camera', Track.Source.Microphone)).toBe(true);
  });

  it('keeps a screen share out of a camera source - the bug this exists for', () => {
    expect(viewAcceptsTrackSource('camera', Track.Source.ScreenShare)).toBe(false);
    expect(viewAcceptsTrackSource('camera', Track.Source.ScreenShareAudio)).toBe(false);
  });

  it('lets a screen source render only the screen share and its audio', () => {
    expect(viewAcceptsTrackSource('screen', Track.Source.ScreenShare)).toBe(true);
    expect(viewAcceptsTrackSource('screen', Track.Source.ScreenShareAudio)).toBe(true);
  });

  it('keeps the face and the microphone out of a screen source', () => {
    expect(viewAcceptsTrackSource('screen', Track.Source.Camera)).toBe(false);
    expect(viewAcceptsTrackSource('screen', Track.Source.Microphone)).toBe(false);
  });

  it('rejects a track whose source the server never labelled', () => {
    for (const view of ['camera', 'screen'] as ViewSource[]) {
      expect(viewAcceptsTrackSource(view, Track.Source.Unknown)).toBe(false);
      expect(viewAcceptsTrackSource(view, '')).toBe(false);
    }
  });

  it('partitions every source a guest can publish into exactly one of the two views', () => {
    for (const source of [
      Track.Source.Camera,
      Track.Source.Microphone,
      Track.Source.ScreenShare,
      Track.Source.ScreenShareAudio,
    ]) {
      const accepted = (['camera', 'screen'] as ViewSource[]).filter((view) =>
        viewAcceptsTrackSource(view, source),
      );
      expect(accepted, `${source} must belong to exactly one view`).toHaveLength(1);
    }
  });
});
