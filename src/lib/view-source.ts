/**
 * Which of a guest's two OBS sources a view page is.
 *
 * A guest publishes up to four tracks: camera, microphone, screen share, and screen
 * share audio. The captain's scene consumes them as *two* browser sources per guest -
 * the face and the screen - and composes them itself. So each view page has to answer
 * one question about every publication it is offered: is this mine?
 *
 * That question used to go unasked, and the consequence was a live bug: the camera
 * source attached any video track its guest published, so starting a screen share
 * replaced that guest's face in the captain's scene, silently, mid-broadcast.
 *
 * Two rules, both here:
 *
 * - The URL says which source a page is. `source=screen` means the screen; anything
 *   else, including the parameter being absent, means the camera. Absent has to mean
 *   camera because every OBS scene the captain has already saved omits it.
 * - A page renders only the tracks belonging to its own source, and the two sets do
 *   not overlap. Camera pages take camera and microphone; screen pages take screen
 *   share and screen share audio.
 *
 * No livekit-client import, deliberately: `scripts/mint.ts` reaches this module
 * through `identity.ts` and must stay free of the browser SDK. The track source
 * strings below are livekit's `Track.Source` values, and test/view-source.test.ts pins
 * them against the real enum so the two cannot drift apart.
 */

/** The two kinds of OBS source a guest has. */
export type ViewSource = 'camera' | 'screen';

/** Query parameter naming the source on the view page. */
export const VIEW_SOURCE_PARAM = 'source';

/** The one value that selects the screen. Everything else is a camera. */
export const SCREEN_VIEW_SOURCE = 'screen';

/**
 * `Track.Source` values each view accepts, as plain strings.
 *
 * Audio is filtered by exactly the same rule as video, so screen-share audio cannot
 * arrive in the sink the captain has wired to a guest's voice.
 */
const ACCEPTED_TRACK_SOURCES: Record<ViewSource, readonly string[]> = {
  camera: ['camera', 'microphone'],
  screen: ['screen_share', 'screen_share_audio'],
};

/**
 * Read the source out of a view URL's `source` parameter.
 *
 * Lenient on purpose - trimmed and case-folded, because these URLs get hand-edited in
 * an OBS properties dialog - but it recognises exactly one value. A typo therefore
 * yields a camera source showing the face, not a page that quietly renders nothing.
 */
export function parseViewSource(raw: string | null | undefined): ViewSource {
  return raw?.trim().toLowerCase() === SCREEN_VIEW_SOURCE ? 'screen' : 'camera';
}

/**
 * Whether a page for `view` may render a track published as `trackSource`.
 *
 * An unlabelled track is rejected by both views rather than guessed at: showing the
 * wrong track on air is worse than showing none.
 */
export function viewAcceptsTrackSource(view: ViewSource, trackSource: string): boolean {
  return ACCEPTED_TRACK_SOURCES[view].includes(trackSource);
}
