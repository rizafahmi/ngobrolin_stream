/**
 * OBS browser source controller.
 *
 * Connects with a subscribe-only token, keeps exactly one participant subscribed, and
 * renders one of their two sources full-bleed. Nothing is ever drawn except that
 * video, because this page is what OBS captures.
 *
 * A guest has two OBS sources - their face and their screen - and this page is one of
 * them, decided by `source=screen` in the URL. Which tracks belong to which source is
 * the rule in `src/lib/view-source.ts`, and every publication goes through it. Before
 * that filter existed, a guest starting a screen share replaced their own face in the
 * captain's scene, silently, mid-broadcast.
 *
 * autoSubscribe is off: with several browser sources open, letting each one subscribe
 * to everybody would pull many times more traffic into the captain's laptop than the
 * show actually needs. Nothing is subscribed until the target participant is found,
 * and then only the tracks this page is for.
 */
import {
  RemoteParticipant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';

import { screenSubscriptionQualityFor, subscriptionQualityFor } from '../lib/quality.ts';
import { VIEW_SOURCE_PARAM, parseViewSource, viewAcceptsTrackSource } from '../lib/view-source.ts';

const LIVEKIT_URL = import.meta.env.PUBLIC_LIVEKIT_URL as string | undefined;

export function startViewPage(): void {
  const params = new URLSearchParams(window.location.search);
  const targetIdentity = params.get('id')?.trim() ?? '';
  const token = params.get('t');
  const debugOn = params.get('debug') === '1';
  const viewSource = parseViewSource(params.get(VIEW_SOURCE_PARAM));

  const stage = document.getElementById('stage') as HTMLElement;
  const video = document.getElementById('feed') as HTMLVideoElement;
  const debugBox = document.getElementById('debug') as HTMLElement;
  const audioSink = document.createElement('audio');
  audioSink.autoplay = true;
  document.body.append(audioSink);

  // A face is cropped to fill the frame; a screen must never be. `contain` letterboxes
  // instead, because a cropped screen loses whatever was at the edge of it - which on
  // a shared window is usually the thing being pointed at.
  stage.dataset.source = viewSource;

  const lines: string[] = [];
  function debug(message: string): void {
    if (!debugOn) return;
    lines.push(message);
    debugBox.hidden = false;
    debugBox.textContent = lines.slice(-14).join('\n');
  }

  if (!targetIdentity || !token || !LIVEKIT_URL) {
    debug(`missing config: id=${targetIdentity || '-'} token=${token ? 'yes' : 'no'} url=${LIVEKIT_URL ?? '-'}`);
    return;
  }

  const { quality, dimensions } =
    viewSource === 'screen' ? screenSubscriptionQualityFor('obs') : subscriptionQualityFor('obs');

  const room = new Room({
    // Adaptive stream would downgrade the layer when OBS backgrounds the source or
    // the element is small. This page always wants the top layer.
    adaptiveStream: false,
    dynacast: false,
  });

  /** Whether a publication belongs to this page at all. */
  function isMine(publication: RemoteTrackPublication): boolean {
    return viewAcceptsTrackSource(viewSource, publication.source);
  }

  /** Subscribe to one publication and pin it to the highest simulcast layer. */
  function take(publication: RemoteTrackPublication): void {
    if (!isMine(publication)) {
      debug(`skip ${publication.source} ${publication.trackSid}`);
      return;
    }
    publication.setSubscribed(true);
    if (publication.kind === Track.Kind.Video) {
      publication.setVideoQuality(quality);
      publication.setVideoDimensions(dimensions);
    }
    debug(`subscribe ${publication.source} ${publication.trackSid}`);
  }

  /** Subscribe to the target's tracks. Everybody else is simply left alone. */
  function adopt(participant: RemoteParticipant): void {
    if (participant.identity !== targetIdentity) return;
    debug(`participant ${participant.identity}`);
    for (const publication of participant.trackPublications.values()) {
      take(publication as RemoteTrackPublication);
    }
  }

  function attach(track: RemoteTrack): void {
    if (track.kind === Track.Kind.Video) {
      track.attach(video);
    } else if (track.kind === Track.Kind.Audio) {
      track.attach(audioSink);
      // OBS launches its browser sources with autoplay unblocked, but a plain Chrome
      // tab used for testing will refuse until something is clicked. Retrying on the
      // first interaction costs nothing and never draws UI.
      void audioSink.play().catch(() => {
        const retry = (): void => {
          void audioSink.play().catch(() => undefined);
          window.removeEventListener('click', retry);
        };
        window.addEventListener('click', retry);
      });
    }
  }

  room
    .on(RoomEvent.ParticipantConnected, (participant) => adopt(participant))
    .on(RoomEvent.TrackPublished, (publication, participant) => {
      if (participant.identity === targetIdentity) take(publication);
    })
    .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      // The subscription filter above already decided this, but a track can only be
      // attached once and the wrong one on air is the failure being designed against,
      // so the rule is applied on the way in as well as on the way out.
      if (participant.identity === targetIdentity && isMine(publication)) attach(track);
    })
    .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      if (participant.identity === targetIdentity && isMine(publication)) track.detach();
    })
    .on(RoomEvent.TrackUnpublished, (publication, participant) => {
      // A guest stopping their screen share unpublishes the track, from the footer
      // button or from Chrome's own stop-sharing bar. Either way this source goes
      // black, which is the correct state for a screen nobody is sharing.
      if (participant.identity !== targetIdentity || !isMine(publication)) return;
      if (publication.kind === Track.Kind.Video) video.srcObject = null;
      debug(`unpublished ${publication.source}`);
    })
    .on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity !== targetIdentity) return;
      // Blank the frame rather than freezing on the last one, so the captain can see
      // at a glance that a guest has dropped.
      video.srcObject = null;
      debug(`gone ${participant.identity}`);
    })
    .on(RoomEvent.Disconnected, (reason) => debug(`disconnected ${reason ?? ''}`));

  room
    .connect(LIVEKIT_URL, token, { autoSubscribe: false })
    .then(() => {
      debug(`connected as ${room.localParticipant.identity} for ${viewSource}`);
      // The guest may already be in the room, in which case no event will fire.
      for (const participant of room.remoteParticipants.values()) {
        adopt(participant);
      }
    })
    .catch((error: unknown) => {
      debug(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
    });

  // Exposed for the local end-to-end checks in the README.
  (window as unknown as Record<string, unknown>).__ngobrolinView = {
    targetIdentity,
    viewSource,
    getRoom: () => room,
  };
}
