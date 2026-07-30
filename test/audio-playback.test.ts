import { describe, expect, it } from 'vitest';
import { AUDIO_BLOCKED_MESSAGE, audioPlaybackNotice } from '../src/lib/audio-playback.ts';

describe('audioPlaybackNotice', () => {
  it('stays silent while the browser is happy to play audio', () => {
    expect(audioPlaybackNotice({ canPlayback: true, remoteAudioCount: 2 })).toEqual({
      visible: false,
      message: AUDIO_BLOCKED_MESSAGE,
    });
  });

  it('warns when playback is blocked and somebody else is publishing audio', () => {
    expect(audioPlaybackNotice({ canPlayback: false, remoteAudioCount: 1 })).toEqual({
      visible: true,
      message: AUDIO_BLOCKED_MESSAGE,
    });
  });

  it('stays silent when blocked but nobody else is in the room yet', () => {
    // Alone in the room there is nothing to hear, so the warning would be a lie
    // about a problem the guest cannot see the effect of.
    expect(audioPlaybackNotice({ canPlayback: false, remoteAudioCount: 0 }).visible).toBe(false);
  });

  it('says it can be fixed by clicking, and does not mention anyone speaking', () => {
    // "cannot play audio yet" must never read as "nobody is talking".
    expect(AUDIO_BLOCKED_MESSAGE).toMatch(/[Kk]lik/);
    expect(AUDIO_BLOCKED_MESSAGE).not.toMatch(/bicara|berbicara|sepi/i);
  });
});
