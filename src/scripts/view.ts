/**
 * OBS browser source controller.
 *
 * Connects with a subscribe-only token, keeps exactly one participant subscribed, and
 * renders their camera full-bleed. Nothing is ever drawn except that video, because
 * this page is what OBS captures.
 *
 * autoSubscribe is off: with four browser sources open, letting each one subscribe to
 * everybody would pull four times more traffic into the captain's laptop than the
 * show actually needs. Nothing is subscribed until the target participant is found.
 */
import {
  RemoteParticipant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';

import { subscriptionQualityFor } from '../lib/quality.ts';

const LIVEKIT_URL = import.meta.env.PUBLIC_LIVEKIT_URL as string | undefined;

export function startViewPage(): void {
  const params = new URLSearchParams(window.location.search);
  const targetIdentity = params.get('id')?.trim() ?? '';
  const token = params.get('t');
  const debugOn = params.get('debug') === '1';

  const video = document.getElementById('feed') as HTMLVideoElement;
  const debugBox = document.getElementById('debug') as HTMLElement;
  const audioSink = document.createElement('audio');
  audioSink.autoplay = true;
  document.body.append(audioSink);

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

  const { quality, dimensions } = subscriptionQualityFor('obs');

  const room = new Room({
    // Adaptive stream would downgrade the layer when OBS backgrounds the source or
    // the element is small. This page always wants the top layer.
    adaptiveStream: false,
    dynacast: false,
  });

  /** Subscribe to one publication and pin it to the highest simulcast layer. */
  function take(publication: RemoteTrackPublication): void {
    publication.setSubscribed(true);
    if (publication.kind === Track.Kind.Video) {
      publication.setVideoQuality(quality);
      publication.setVideoDimensions(dimensions);
    }
    debug(`subscribe ${publication.kind} ${publication.trackSid}`);
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
    .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (participant.identity === targetIdentity) attach(track);
    })
    .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (participant.identity === targetIdentity) track.detach();
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
      debug(`connected as ${room.localParticipant.identity}`);
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
    getRoom: () => room,
  };
}
