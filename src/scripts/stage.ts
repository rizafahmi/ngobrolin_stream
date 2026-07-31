/**
 * The composed stage: one OBS browser source that is the whole room.
 *
 * Where `view.ts` renders exactly one participant's one source full-bleed, this page
 * renders the *arrangement*: somebody's screen large with the faces beside it, or an
 * even grid of faces when nobody is sharing. The arrangement itself is not decided
 * here - it comes from `src/lib/stage.ts`, which every guest's page also calls, so what
 * goes on air is what the participants see.
 *
 * Three rules make this page safe to point OBS at, and all three are structural:
 *
 * - **Nothing but video is ever drawn.** No names, no plates, no borders, no status,
 *   no errors. The captain composites overlays in the scene as separate assets. When
 *   something is wrong this page stays transparent, which is the correct failure mode
 *   mid-recording. `&debug=1` is the one exception and is never on for a show.
 * - **No audio, ever.** Not "no audio elements" - no audio *subscriptions*. The filter
 *   is `renderAcceptsTrackSource('obs', ...)`, so a microphone track is never pulled
 *   down at all. The captain mixes per-guest audio with individual faders, and one
 *   composed leg arriving here would wreck that.
 * - **Quality follows the slot, not the page.** A face in the filmstrip is 360 px wide
 *   and takes the 360p layer; a screen on stage takes the top one. That mapping is
 *   re-applied every time the composition changes, because a track that gets promoted
 *   has to upgrade and a track that gets demoted has to stop costing what it did.
 *
 * `autoSubscribe` is off for the same reason it is off on the view page: this source is
 * in the same OBS as several others, and letting it take everything by default would
 * pull far more into the captain's laptop than the show needs.
 */
import {
  RemoteParticipant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';

import { isObsIdentity } from '../lib/identity.ts';
import { slotSubscriptionQualityFor } from '../lib/quality.ts';
import {
  OBS_CANVAS,
  OBS_GRID_MAX_TILE_WIDTH,
  compose,
  layoutCells,
  renderAcceptsTrackSource,
  type CellBox,
  type CompositionParticipant,
} from '../lib/stage.ts';

const LIVEKIT_URL = import.meta.env.PUBLIC_LIVEKIT_URL as string | undefined;

export function startStagePage(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  const debugOn = params.get('debug') === '1';

  const canvas = document.getElementById('canvas') as HTMLElement;
  const debugBox = document.getElementById('debug') as HTMLElement;

  const lines: string[] = [];
  function debug(message: string): void {
    if (!debugOn) return;
    lines.push(message);
    debugBox.hidden = false;
    debugBox.textContent = lines.slice(-14).join('\n');
  }

  /**
   * Scale the fixed 1920x1080 canvas into whatever window it is in.
   *
   * A no-op in OBS, where the browser source is set to exactly that. It exists so a
   * plain browser tab at any size shows the identical composition rather than a
   * differently-arranged one, which is what makes checking this page locally worth
   * anything.
   */
  function fitCanvas(): void {
    const scale = Math.min(
      window.innerWidth / OBS_CANVAS.width,
      window.innerHeight / OBS_CANVAS.height,
    );
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  if (!token || !LIVEKIT_URL) {
    debug(`missing config: token=${token ? 'yes' : 'no'} url=${LIVEKIT_URL ?? '-'}`);
    return;
  }

  const room = new Room({
    // Adaptive stream would pick a layer from the element size and from whether OBS has
    // the source backgrounded. Every layer here is chosen deliberately by slot instead.
    adaptiveStream: false,
    dynacast: false,
  });

  /** The last quality asked for per track, so a re-render is not a signalling storm. */
  const appliedQuality = new Map<string, string>();

  // ---------- room state -> composition ----------

  /** Guests, in no particular order: the composition decides that, not the SFU. */
  function guests(): RemoteParticipant[] {
    return (Array.from(room.remoteParticipants.values()) as RemoteParticipant[]).filter(
      // Belt and braces: every OBS token is `hidden`, so these should not be here at
      // all. If one ever is, it must not become a black cell in the middle of the show.
      (participant) => !isObsIdentity(participant.identity),
    );
  }

  function participantsForCompose(): CompositionParticipant[] {
    return guests().map((participant) => ({
      identity: participant.identity,
      isLocal: false,
      sharing: isSharing(participant),
    }));
  }

  /**
   * Whether this participant is sharing, judged from the *publication* rather than from
   * a subscribed track.
   *
   * The composition has to settle before the subscription is made, not after: the cell
   * is what tells this page which layer to ask for, so waiting for the track would mean
   * asking for the wrong one first and correcting it a moment later.
   */
  function isSharing(participant: RemoteParticipant): boolean {
    const publication = participant.getTrackPublication(Track.Source.ScreenShare);
    return Boolean(publication) && !publication!.isMuted;
  }

  function publicationFor(box: CellBox): RemoteTrackPublication | undefined {
    const participant = room.remoteParticipants.get(box.identity);
    const source = box.kind === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera;
    return participant?.getTrackPublication(source) as RemoteTrackPublication | undefined;
  }

  // ---------- subscription ----------

  /** Take a publication if this render is allowed it, and never if it is not. */
  function take(publication: RemoteTrackPublication): void {
    if (!renderAcceptsTrackSource('obs', publication.source)) {
      debug(`skip ${publication.source}`);
      return;
    }
    publication.setSubscribed(true);
  }

  function subscribeAll(): void {
    for (const participant of guests()) {
      for (const publication of participant.trackPublications.values()) {
        take(publication as RemoteTrackPublication);
      }
    }
  }

  // ---------- rendering ----------

  function render(): void {
    const composition = compose(participantsForCompose(), 'obs');
    const boxes = layoutCells(composition, OBS_CANVAS, { maxTileWidth: OBS_GRID_MAX_TILE_WIDTH });

    const seen = new Set<string>();
    for (const box of boxes) {
      seen.add(box.key);
      paintCell(box);
    }
    for (const node of Array.from(canvas.children) as HTMLElement[]) {
      if (!seen.has(node.dataset.key ?? '')) node.remove();
    }

    applyCompositionQuality(boxes);
    debug(`${composition.layout}: ${boxes.map((b) => `${b.key}@${b.slot}`).join(' ')}`);
  }

  /**
   * Draw one cell.
   *
   * The element is keyed and reused across renders, so a face demoted from the even
   * grid to the filmstrip changes size rather than being rebuilt. Re-attaching a track
   * would restart playback and flash the cell black, on air, every time somebody
   * started or stopped sharing.
   */
  function paintCell(box: CellBox): void {
    let node = canvas.querySelector<HTMLElement>(`[data-key="${cssEscape(box.key)}"]`);
    if (!node) {
      node = document.createElement('div');
      node.className = 'cell';
      node.dataset.key = box.key;
      node.innerHTML = '<video autoplay playsinline muted></video>';
      canvas.append(node);
    }
    // A face is cropped to fill its cell; a screen is letterboxed, never cropped, since
    // the edge of a shared window is usually the thing being pointed at.
    node.dataset.kind = box.kind;
    node.dataset.slot = box.slot;
    node.style.left = `${box.left}px`;
    node.style.top = `${box.top}px`;
    node.style.width = `${box.width}px`;
    node.style.height = `${box.height}px`;

    const video = node.querySelector('video') as HTMLVideoElement;
    const publication = publicationFor(box);
    const track = publication?.track;
    if (track && !publication!.isMuted) {
      if (video.dataset.trackSid !== publication!.trackSid) {
        track.attach(video);
        video.dataset.trackSid = publication!.trackSid;
      }
      video.hidden = false;
    } else {
      // Camera off, or the track not yet subscribed. The cell stays and stays black
      // rather than collapsing, so nobody's slot moves when they cover their lens.
      video.hidden = true;
      delete video.dataset.trackSid;
      video.srcObject = null;
    }
  }

  /**
   * Ask the SFU for the layer each cell's slot deserves, and only when it changed.
   *
   * The "only when it changed" half is not an optimisation. This runs on every render,
   * including every window resize, and re-sending an identical preference dozens of
   * times a second would be a signalling storm for nothing.
   *
   * The "every render" half is the substance: a screen promoted to the stage has to
   * upgrade to the top layer, and the faces it displaced have to drop to 360p. Applying
   * this once on TrackSubscribed - which is all this project needed before there was a
   * composition - would freeze both at whatever they happened to be first.
   */
  function applyCompositionQuality(boxes: CellBox[]): void {
    for (const box of boxes) {
      const publication = publicationFor(box);
      if (!publication?.isSubscribed || publication.kind !== Track.Kind.Video) continue;
      const { quality, dimensions } = slotSubscriptionQualityFor('obs', box.slot, box.kind);
      const wanted = `${quality}:${dimensions.width}x${dimensions.height}`;
      if (appliedQuality.get(publication.trackSid) === wanted) continue;
      appliedQuality.set(publication.trackSid, wanted);
      publication.setVideoQuality(quality);
      publication.setVideoDimensions(dimensions);
      debug(`quality ${box.key} ${box.slot} -> ${wanted}`);
    }
  }

  function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
  }

  // ---------- wiring ----------

  room
    .on(RoomEvent.ParticipantConnected, () => {
      subscribeAll();
      render();
    })
    .on(RoomEvent.ParticipantDisconnected, () => render())
    .on(RoomEvent.TrackPublished, (publication) => {
      take(publication);
      // A screen share appearing is what turns the even grid into a presentation, so
      // this has to rearrange, not just subscribe.
      render();
    })
    .on(RoomEvent.TrackUnpublished, (publication) => {
      appliedQuality.delete(publication.trackSid);
      render();
    })
    .on(RoomEvent.TrackSubscribed, (_track: RemoteTrack, publication) => {
      // The subscription filter already decided this. Applying it again on the way in
      // is cheap and means a track the SFU pushed unasked cannot reach the canvas.
      if (renderAcceptsTrackSource('obs', publication.source)) render();
    })
    .on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      track.detach();
      appliedQuality.delete(publication.trackSid);
      render();
    })
    .on(RoomEvent.TrackMuted, () => render())
    .on(RoomEvent.TrackUnmuted, () => render())
    .on(RoomEvent.Disconnected, (reason) => debug(`disconnected ${reason ?? ''}`));

  room
    .connect(LIVEKIT_URL, token, { autoSubscribe: false })
    .then(() => {
      debug(`connected as ${room.localParticipant.identity}`);
      // Guests are usually already in the room when OBS reconnects, in which case no
      // event will ever fire for them.
      subscribeAll();
      render();
    })
    .catch((error: unknown) => {
      debug(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
    });

  // Exposed for the local end-to-end checks in the README.
  (window as unknown as Record<string, unknown>).__ngobrolinStage = {
    getRoom: () => room,
    getComposition: () => compose(participantsForCompose(), 'obs'),
  };
}
