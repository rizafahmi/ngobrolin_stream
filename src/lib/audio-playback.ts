/**
 * Blocked-audio notice policy.
 *
 * Browsers refuse to start audio playback on a page that has never been interacted
 * with. A blocked `play()` is completely silent and completely invisible, so from the
 * guest's side it looks exactly like a room where nobody is talking. That is a
 * different problem with a different fix, so it gets its own state and its own words:
 * never folded into the speaking cue.
 *
 * LiveKit already models this as `Room.canPlaybackAudio` plus
 * `RoomEvent.AudioPlaybackStatusChanged`, with `Room.startAudio()` as the fix that
 * must be called from a real user gesture.
 */

export const AUDIO_BLOCKED_MESSAGE =
  'Suara tamu lain belum bisa diputar oleh browser. Klik di sini untuk mengaktifkannya.';

export interface AudioPlaybackInput {
  /** Room.canPlaybackAudio. */
  canPlayback: boolean;
  /** How many remote microphone tracks are subscribed right now. */
  remoteAudioCount: number;
}

export interface AudioPlaybackNotice {
  visible: boolean;
  message: string;
}

/**
 * Whether to show the "tap to enable audio" notice.
 *
 * Blocked playback only matters once there is something to hear. Alone in the room
 * the notice would warn about a problem with no observable effect, and a warning the
 * guest cannot verify is a warning they learn to ignore.
 */
export function audioPlaybackNotice({
  canPlayback,
  remoteAudioCount,
}: AudioPlaybackInput): AudioPlaybackNotice {
  return {
    visible: !canPlayback && remoteAudioCount > 0,
    message: AUDIO_BLOCKED_MESSAGE,
  };
}
