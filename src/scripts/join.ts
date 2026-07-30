/**
 * Join page controller.
 *
 * Two stages live in one document: the pre-join card and the in-room grid. Keeping
 * them in one page means the tracks captured for the preview are the exact tracks
 * that get published, so a guest who saw themselves in the preview cannot then join
 * with a dead camera.
 */
import {
  ConnectionState,
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalTracks,
  supportsAudioOutputSelection,
  type Participant,
  type RemoteParticipant,
} from 'livekit-client';

import { audioPlaybackNotice } from '../lib/audio-playback.ts';
import { connectionStatus } from '../lib/connection-status.ts';
import { deviceOptions, offerSpeakerPicker, resolveActiveDevice, type DeviceOption } from '../lib/devices.ts';
import { ROOM_NAME } from '../lib/identity.ts';
import { gridColumns, orderTiles, tileWidth } from '../lib/layout.ts';
import { classifyJoinFailure, classifyMediaError, classifyScreenShareError } from '../lib/media-errors.ts';
import { micCue, micLevelPercent, peakAmplitude } from '../lib/mic-cue.ts';
import {
  AUDIO_CAPTURE_CONSTRAINTS,
  PUBLISH_AUDIO_PRESET,
  PUBLISH_SCREEN_AUDIO_PRESET,
  PUBLISH_SCREEN_PRESET,
  PUBLISH_VIDEO_PRESET,
  screenSubscriptionQualityFor,
  subscriptionQualityFor,
} from '../lib/quality.ts';
import { decodeTokenPayload } from '../lib/jwt.ts';

const LIVEKIT_URL = import.meta.env.PUBLIC_LIVEKIT_URL as string | undefined;

type Panel = 'permission' | 'denied' | 'nodevice' | 'ready' | 'fatal';

interface PreviewState {
  video: LocalVideoTrack | null;
  audio: LocalAudioTrack | null;
}

/** One cell of the grid. A guest sharing their screen owns two of these. */
interface TileSpec {
  /** Unique per cell. `<identity>` for a face, `<identity>.screen` for a screen. */
  key: string;
  kind: 'camera' | 'screen';
  participant: Participant;
  isLocal: boolean;
}

export function startJoinPage(): void {
  const el = collectElements();
  const preview: PreviewState = { video: null, audio: null };
  let room: Room | null = null;
  // Latest peak amplitude of this guest's own captured audio, 0..1. Fed by the single
  // analyser started in startLevelMonitor and read by whichever bar is on screen.
  let localLevel = 0;
  let levelMonitorRunning = false;
  // The speaker chosen on the join card, carried into Room options at join time.
  // Session-scoped on purpose: a reload goes back to the browser default.
  let speakerId: string | undefined;

  const token = new URLSearchParams(window.location.search).get('t');

  // ---------- panel switching ----------

  function showPanel(panel: Panel): void {
    for (const [name, node] of Object.entries(el.panels)) {
      node.hidden = name !== panel;
    }
  }

  function showError(message: string | null): void {
    el.joinError.hidden = message === null;
    el.joinError.textContent = message ?? '';
  }

  function fatal(title: string, body: string): void {
    el.fatalTitle.textContent = title;
    el.fatalBody.textContent = body;
    showPanel('fatal');
  }

  // ---------- entry ----------

  if (!token) {
    fatal(
      'Link tidak lengkap',
      'Link ini tidak berisi kode masuk. Minta link baru ke Riza, lalu buka link itu langsung tanpa mengetik ulang alamatnya.',
    );
    return;
  }

  if (!LIVEKIT_URL) {
    fatal(
      'Studio belum dikonfigurasi',
      'Alamat server LiveKit belum diisi saat situs ini dibangun. Ini masalah di sisi Riza, bukan di sisi kamu.',
    );
    return;
  }

  // The name claim in the token is only a default. Whatever the guest types wins on
  // screen, but it never touches their identity, so their OBS source keeps working.
  const claims = decodeTokenPayload(token);
  const suggestedName = typeof claims?.name === 'string' ? claims.name : '';
  el.inputName.value = suggestedName;

  showPanel('permission');

  // ---------- media permission ----------

  async function requestMedia(): Promise<void> {
    showError(null);
    el.previewCaption.textContent = 'Menyalakan kamera...';
    try {
      // One call rather than createLocalVideoTrack + createLocalAudioTrack in
      // parallel: the two contend inside the client's device handling and never
      // settle, and a single call also means Chrome shows the guest one permission
      // prompt covering both devices instead of two in a row.
      const tracks = await createLocalTracks({
        video: { resolution: PUBLISH_VIDEO_PRESET.resolution },
        audio: { ...AUDIO_CAPTURE_CONSTRAINTS },
      });
      const video = tracks.find((track): track is LocalVideoTrack => track instanceof LocalVideoTrack);
      const audio = tracks.find((track): track is LocalAudioTrack => track instanceof LocalAudioTrack);
      if (!video || !audio) {
        throw Object.assign(new Error('camera or microphone track missing'), { name: 'NotFoundError' });
      }
      preview.video = video;
      preview.audio = audio;
      attachPreview(video);
      startLevelMonitor();
      await populateDeviceLists();
      showPanel('ready');
    } catch (error) {
      handleMediaError(error);
    }
  }

  function handleMediaError(error: unknown): void {
    el.previewVideo.hidden = true;
    el.previewPlaceholder.hidden = false;
    el.previewCaption.textContent = 'Kamera belum aktif';

    const verdict = classifyMediaError(error);
    showPanel(verdict.panel);
    showError(verdict.message);
  }

  function attachPreview(video: LocalVideoTrack): void {
    video.attach(el.previewVideo);
    el.previewVideo.hidden = false;
    el.previewPlaceholder.hidden = true;
  }

  // ---------- device pickers ----------

  async function populateDeviceLists(): Promise<void> {
    // Labels are empty until permission is granted, which is why this runs after
    // the tracks exist rather than on page load.
    const devices = await navigator.mediaDevices.enumerateDevices();
    const camId = preview.video?.mediaStreamTrack.getSettings().deviceId;
    const micId = preview.audio?.mediaStreamTrack.getSettings().deviceId;
    renderSelect(el.selectCamera, deviceOptions(devices, 'videoinput', camId, 'Kamera'));
    renderSelect(el.selectMic, deviceOptions(devices, 'audioinput', micId, 'Mikrofon'));

    const offerSpeaker = offerSpeakerPicker(supportsAudioOutputSelection(), devices);
    el.fieldSpeaker.hidden = !offerSpeaker;
    if (offerSpeaker) {
      // If the chosen speaker was unplugged, fall back to the browser default so the
      // picker never claims a device that no longer exists.
      speakerId = resolveActiveDevice(speakerId, devices, 'audiooutput');
      renderSelect(el.selectSpeaker, deviceOptions(devices, 'audiooutput', speakerId, 'Speaker'));
    }
  }

  function renderSelect(select: HTMLSelectElement, options: DeviceOption[]): void {
    select.replaceChildren(
      ...options.map((entry) => {
        const option = document.createElement('option');
        option.value = entry.value;
        option.textContent = entry.label;
        option.selected = entry.selected;
        return option;
      }),
    );
  }

  // Device switching is only offered before joining, so there is no published track
  // to swap out - changing the preview track is enough.
  async function switchCamera(deviceId: string): Promise<void> {
    if (!preview.video) return;
    try {
      await preview.video.setDeviceId(deviceId);
    } catch (error) {
      showError(`Tidak bisa pindah kamera: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function switchMic(deviceId: string): Promise<void> {
    if (!preview.audio) return;
    try {
      // The level monitor re-binds itself when the underlying MediaStreamTrack
      // changes, so nothing here has to restart it.
      await preview.audio.setDeviceId(deviceId);
    } catch (error) {
      showError(`Tidak bisa pindah mikrofon: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---------- microphone level meter ----------

  /** This guest's own microphone track, wherever it currently lives. */
  function localMicTrack(): LocalAudioTrack | null {
    if (room) {
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const track = publication?.track;
      return track instanceof LocalAudioTrack ? track : null;
    }
    return preview.audio;
  }

  /**
   * One analyser for the whole session, feeding both level bars.
   *
   * The join card's bar and the local tile's bar are the same measurement shown in two
   * places, so there is exactly one AudioContext and it keeps running across the join:
   * the reassurance the bar gives is needed most *after* joining, which is precisely
   * where the page used to go quiet.
   *
   * It re-binds whenever the underlying MediaStreamTrack changes rather than being
   * restarted by every caller that might change it. That covers an in-room mic switch
   * (`Room.switchActiveDevice` swaps the media track inside the live publication) and
   * every unmute (muting stops the track and unmuting creates a new one).
   */
  function startLevelMonitor(): void {
    if (levelMonitorRunning) return;
    levelMonitorRunning = true;

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let source: MediaStreamAudioSourceNode | null = null;
    let bound: MediaStreamTrack | null = null;

    const tick = (): void => {
      const media = localMicTrack()?.mediaStreamTrack ?? null;
      if (media !== bound) {
        source?.disconnect();
        source = media ? context.createMediaStreamSource(new MediaStream([media])) : null;
        source?.connect(analyser);
        bound = media;
      }
      if (source) {
        analyser.getByteTimeDomainData(buffer);
        localLevel = peakAmplitude(buffer);
      } else {
        localLevel = 0;
      }
      paintCues();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * Paint the live cues: the join card's bar before joining, and in the room the
   * speaking outline on every tile plus the level bar on this guest's own tile.
   *
   * This is deliberately separate from renderGrid. Levels and speaking change many
   * times a second, tile structure changes when somebody joins or leaves, and
   * rebuilding tiles at frame rate would flash video.
   */
  function paintCues(): void {
    if (!room) {
      const width = `${micLevelPercent(localLevel)}%`;
      if (el.meterFill.style.width !== width) el.meterFill.style.width = width;
      return;
    }
    for (const node of Array.from(el.grid.children) as HTMLElement[]) {
      // A shared screen is not a person: it cannot speak and it has no microphone, so
      // neither cue means anything on it.
      if (node.dataset.kind === 'screen') continue;
      const participant = participantByIdentity(node.dataset.identity ?? '');
      if (!participant) continue;
      const isLocal = participant === room.localParticipant;
      const micPub = participant.getTrackPublication(Track.Source.Microphone);
      const cue = micCue({
        // No microphone publication at all counts as muted: from every other guest's
        // side the effect is identical.
        muted: micPub?.isMuted ?? true,
        // Remote speaking comes from the SFU via ActiveSpeakersChanged. Only the local
        // guest's own capture can be measured here, so only their tile gets a level.
        speaking: participant.isSpeaking,
        level: isLocal ? localLevel : 0,
      });
      // Written only on change. This runs on every animation frame, and re-writing
      // identical values would dirty the tree - and the accessibility snapshot built
      // from it - sixty times a second for nothing.
      if (node.classList.contains('is-speaking') !== cue.speaking) {
        node.classList.toggle('is-speaking', cue.speaking);
      }
      const fill = node.querySelector<HTMLElement>('.tile-level-fill');
      const width = `${cue.levelPercent}%`;
      if (fill && fill.style.width !== width) fill.style.width = width;
    }
  }

  function participantByIdentity(identity: string): Participant | undefined {
    if (!room) return undefined;
    if (identity === room.localParticipant.identity) return room.localParticipant;
    return room.remoteParticipants.get(identity);
  }

  // ---------- blocked audio playback ----------

  /**
   * Browsers refuse to start audio on a page nobody has interacted with, and a blocked
   * play() is silent and invisible - indistinguishable from a room where nobody is
   * talking. This says so in its own words, and offers the one thing that fixes it:
   * a real user gesture, which is what Room.startAudio needs.
   */
  function updateAudioNotice(): void {
    if (!room) return;
    let remoteAudioCount = 0;
    for (const participant of room.remoteParticipants.values()) {
      if (participant.getTrackPublication(Track.Source.Microphone)?.track) remoteAudioCount += 1;
    }
    const notice = audioPlaybackNotice({
      canPlayback: room.canPlaybackAudio,
      remoteAudioCount,
    });
    el.audioBlocked.textContent = notice.message;
    el.audioBlocked.hidden = !notice.visible;
  }

  // ---------- joining ----------

  async function join(): Promise<void> {
    if (!preview.video || !preview.audio || !token || !LIVEKIT_URL) return;
    el.btnJoin.disabled = true;
    el.btnJoin.textContent = 'Menyambung...';
    showError(null);

    const displayName = el.inputName.value.trim() || suggestedName || 'Tamu';

    try {
      room = new Room({
        // Quality is decided explicitly per page rather than inferred from element
        // size: the grid always wants the bottom layer, OBS always wants the top.
        adaptiveStream: false,
        // Lets the SFU tell this guest to stop encoding layers nobody is watching,
        // which is where most of the uplink saving comes from.
        dynacast: true,
        videoCaptureDefaults: { resolution: PUBLISH_VIDEO_PRESET.resolution },
        audioCaptureDefaults: { ...AUDIO_CAPTURE_CONSTRAINTS },
        // The speaker picked on the join card. The Room applies it to every remote
        // audio element it knows about, including tiles created later.
        audioOutput: speakerId ? { deviceId: speakerId } : undefined,
      });
      wireRoomEvents(room);

      await room.connect(LIVEKIT_URL, token);
      if (displayName !== room.localParticipant.name) {
        // Cosmetic only, and best-effort: an older token minted without
        // canUpdateOwnMetadata will reject this, which is not worth failing a join
        // over. The identity - the part OBS depends on - is unaffected either way.
        await room.localParticipant.setName(displayName).catch(() => undefined);
      }

      await room.localParticipant.publishTrack(preview.video, {
        simulcast: true,
        videoCodec: 'vp8',
        videoEncoding: { ...PUBLISH_VIDEO_PRESET.encoding },
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        source: Track.Source.Camera,
      });
      await room.localParticipant.publishTrack(preview.audio, {
        audioPreset: { maxBitrate: PUBLISH_AUDIO_PRESET.maxBitrate },
        dtx: PUBLISH_AUDIO_PRESET.dtx,
        red: PUBLISH_AUDIO_PRESET.red,
        source: Track.Source.Microphone,
      });

      // The level monitor keeps running: from here it drives the local tile's bar.
      el.meterFill.style.width = '0%';
      el.stageJoin.hidden = true;
      el.stageRoom.hidden = false;
      renderGrid();
    } catch (error) {
      el.btnJoin.disabled = false;
      el.btnJoin.textContent = 'Masuk Studio';
      showError(classifyJoinFailure(error));
      room = null;
    }
  }

  // ---------- room events ----------

  function wireRoomEvents(target: Room): void {
    const rerender = (): void => renderGrid();
    target
      .on(RoomEvent.ParticipantConnected, rerender)
      .on(RoomEvent.ParticipantDisconnected, rerender)
      .on(RoomEvent.TrackSubscribed, (_track, publication) => {
        applyGridQuality(publication);
        renderGrid();
      })
      .on(RoomEvent.TrackUnsubscribed, rerender)
      .on(RoomEvent.TrackMuted, rerender)
      .on(RoomEvent.TrackUnmuted, rerender)
      .on(RoomEvent.ParticipantNameChanged, rerender)
      .on(RoomEvent.LocalTrackPublished, () => {
        paintScreenButton();
        renderGrid();
      })
      // The guest's own share ending: either from the footer button, or from Chrome's
      // stop-sharing bar, which livekit turns into an unpublish. Guests use that bar,
      // so this is not an optional path.
      .on(RoomEvent.LocalTrackUnpublished, () => {
        paintScreenButton();
        renderGrid();
      })
      // A remote guest starting or stopping a share adds or removes a whole cell.
      .on(RoomEvent.TrackPublished, rerender)
      .on(RoomEvent.TrackUnpublished, rerender)
      // The level monitor's frame loop repaints the cues anyway; this is the correct
      // trigger for the remote half of them and keeps the outlines honest in a
      // backgrounded tab, where requestAnimationFrame stops firing.
      .on(RoomEvent.ActiveSpeakersChanged, () => paintCues())
      .on(RoomEvent.AudioPlaybackStatusChanged, () => updateAudioNotice())
      .on(RoomEvent.ActiveDeviceChanged, (kind, deviceId) => {
        // Fires on our own switches and on livekit's automatic fallback when the
        // active device is unplugged; either way the open picker must follow.
        if (kind === 'audiooutput') speakerId = deviceId;
        if (!el.devicesPop.hidden) void refreshRoomDeviceLists();
      })
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        updateStatus(state);
        renderGrid();
      })
      .on(RoomEvent.Disconnected, () => {
        updateStatus(ConnectionState.Disconnected);
      });
  }

  function updateStatus(state: ConnectionState): void {
    const status = connectionStatus(state);
    el.roomStatus.dataset.state = status.state;
    el.roomStatus.textContent = status.label;
  }

  /**
   * Ask the SFU for the smallest layer of every remote video track.
   *
   * OBS is the only consumer that needs full resolution. Doing this on every
   * subscription is what keeps a five-person room from costing each guest four
   * simultaneous 720p downstreams - and it matters more for a shared screen than for a
   * camera, since a screen's top layer is 1080p.
   */
  function applyGridQuality(publication: RemoteTrackPublication): void {
    if (publication.kind !== Track.Kind.Video) return;
    const { quality, dimensions } =
      publication.source === Track.Source.ScreenShare
        ? screenSubscriptionQualityFor('grid')
        : subscriptionQualityFor('grid');
    publication.setVideoQuality(quality);
    publication.setVideoDimensions(dimensions);
  }

  // ---------- grid rendering ----------

  /**
   * The tiles the grid should be showing, keyed rather than identified.
   *
   * A guest sharing their screen occupies two cells, so a participant identity is no
   * longer a unique key. `key` is what the DOM is keyed on and what the order is sorted
   * by: `<identity>` for a face and `<identity>.screen` for a screen, which sorts a
   * screen immediately after the face it belongs to.
   *
   * The local guest deliberately gets no screen tile. They are looking at the thing
   * they are sharing; adding a tile of it means a window inside a window inside a
   * window whenever they share the whole display.
   */
  function tileSpecs(): TileSpec[] {
    if (!room) return [];
    const specs: TileSpec[] = [];
    for (const participant of Array.from(room.remoteParticipants.values()) as RemoteParticipant[]) {
      specs.push({
        key: participant.identity,
        kind: 'camera',
        participant,
        isLocal: false,
      });
      if (participant.getTrackPublication(Track.Source.ScreenShare)?.track) {
        specs.push({
          key: `${participant.identity}.screen`,
          kind: 'screen',
          participant,
          isLocal: false,
        });
      }
    }
    specs.push({
      key: room.localParticipant.identity,
      kind: 'camera',
      participant: room.localParticipant,
      isLocal: true,
    });
    return specs;
  }

  function renderGrid(): void {
    if (!room) return;

    const tiles = orderTiles(tileSpecs().map((spec) => ({ ...spec, identity: spec.key })));

    sizeGrid(tiles.length);

    const seen = new Set<string>();
    for (const tile of tiles) {
      seen.add(tile.key);
      renderTile(tile);
    }
    for (const node of Array.from(el.grid.children) as HTMLElement[]) {
      if (!seen.has(node.dataset.key ?? '')) node.remove();
    }
    // Re-append in order so DOM order matches the intended tile order.
    for (const tile of tiles) {
      const node = el.grid.querySelector<HTMLElement>(`[data-key="${cssEscape(tile.key)}"]`);
      if (node) el.grid.append(node);
    }

    // A tile created this render has no cues on it yet, and whether anyone's audio is
    // playable depends on who is in the room.
    paintCues();
    updateAudioNotice();
  }

  /**
   * Size the tracks to the largest tiles that still fit without scrolling.
   *
   * The grid's own box is the available area: it is the flex child between the
   * header and the control bar, so its height already excludes both.
   */
  function sizeGrid(tileCount: number): void {
    if (tileCount === 0) return;
    const style = getComputedStyle(el.grid);
    const width = el.grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = el.grid.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const size = tileWidth(tileCount, width, height);
    el.grid.style.gridTemplateColumns = `repeat(${gridColumns(tileCount)}, ${size}px)`;
  }

  function renderTile(spec: TileSpec): void {
    if (spec.kind === 'screen') {
      renderScreenTile(spec);
      return;
    }
    const { participant, isLocal } = spec;
    let node = el.grid.querySelector<HTMLElement>(`[data-key="${cssEscape(spec.key)}"]`);
    if (!node) {
      node = document.createElement('div');
      node.className = 'tile';
      node.dataset.key = spec.key;
      node.dataset.kind = 'camera';
      node.dataset.identity = participant.identity;
      node.innerHTML = `
        <div class="tile-avatar"></div>
        <video autoplay playsinline></video>
        <span class="tile-name"></span>
        <span class="tile-muted" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3l18 18M9 9v3a3 3 0 0 0 4.5 2.6M15 11V5a3 3 0 0 0-6-.6M5 11a7 7 0 0 0 10.3 6.2M12 18v4" />
          </svg>
        </span>
        <!-- Only shown on the local tile, where the level is actually measurable.
             CSS hides it elsewhere; paintCues writes the width. -->
        <span class="tile-level"><span class="tile-level-fill"></span></span>`;
      el.grid.append(node);
    }
    node.classList.toggle('is-local', isLocal);

    const video = node.querySelector('video') as HTMLVideoElement;
    const avatar = node.querySelector('.tile-avatar') as HTMLElement;
    const nameLabel = node.querySelector('.tile-name') as HTMLElement;
    const mutedBadge = node.querySelector('.tile-muted') as HTMLElement;

    const displayName = participant.name || participant.identity;
    nameLabel.textContent = isLocal ? `${displayName} (kamu)` : displayName;

    const cameraPub = participant.getTrackPublication(Track.Source.Camera);
    const micPub = participant.getTrackPublication(Track.Source.Microphone);

    if (cameraPub?.track && !cameraPub.isMuted) {
      // Re-attach only when the underlying track actually changed, otherwise every
      // unrelated re-render would restart playback and flash the tile black.
      if (video.dataset.trackSid !== cameraPub.trackSid) {
        cameraPub.track.attach(video);
        video.dataset.trackSid = cameraPub.trackSid;
      }
      video.hidden = false;
      avatar.hidden = true;
    } else {
      video.hidden = true;
      delete video.dataset.trackSid;
      avatar.hidden = false;
      avatar.textContent = displayName.slice(0, 1).toUpperCase();
    }

    // The local participant hears themselves through their own ears, not the SFU,
    // so attaching local audio here would be a feedback loop.
    if (!isLocal && micPub?.track && micPub.kind === Track.Kind.Audio) {
      let audio = node.querySelector('audio');
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        node.append(audio);
      }
      if (audio.dataset.trackSid !== micPub.trackSid) {
        micPub.track.attach(audio);
        audio.dataset.trackSid = micPub.trackSid;
      }
    }

    // A participant with no microphone publication at all counts as muted: from the
    // other guests' side the effect is identical.
    mutedBadge.hidden = !(micPub?.isMuted ?? true);
  }

  /**
   * A remote guest's shared screen, as its own cell.
   *
   * Deliberately barer than a camera tile: a name so it is clear whose screen this is,
   * and nothing else. No avatar (a screen has no fallback worth drawing), no muted
   * badge and no speaking cues (they belong to a person, and this cell is not one).
   *
   * The screen's audio is attached here, so a guest can hear the clip they are
   * reacting to. The captain gets that audio separately and cleanly, as part of the
   * screen browser source, rather than as whatever the sharer's microphone caught.
   */
  function renderScreenTile(spec: TileSpec): void {
    const { participant } = spec;
    let node = el.grid.querySelector<HTMLElement>(`[data-key="${cssEscape(spec.key)}"]`);
    if (!node) {
      node = document.createElement('div');
      node.className = 'tile';
      node.dataset.key = spec.key;
      node.dataset.kind = 'screen';
      node.dataset.identity = participant.identity;
      node.innerHTML = `
        <video autoplay playsinline></video>
        <span class="tile-name"></span>`;
      el.grid.append(node);
    }

    const video = node.querySelector('video') as HTMLVideoElement;
    const nameLabel = node.querySelector('.tile-name') as HTMLElement;
    nameLabel.textContent = `Layar ${participant.name || participant.identity}`;

    const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
    if (screenPub?.track && video.dataset.trackSid !== screenPub.trackSid) {
      screenPub.track.attach(video);
      video.dataset.trackSid = screenPub.trackSid;
    }

    const screenAudioPub = participant.getTrackPublication(Track.Source.ScreenShareAudio);
    if (screenAudioPub?.track) {
      let audio = node.querySelector('audio');
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        node.append(audio);
      }
      if (audio.dataset.trackSid !== screenAudioPub.trackSid) {
        screenAudioPub.track.attach(audio);
        audio.dataset.trackSid = screenAudioPub.trackSid;
      }
    }
  }

  function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
  }

  // ---------- in-room controls ----------

  async function toggleMic(): Promise<void> {
    if (!room) return;
    const enabled = !room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    el.btnMic.dataset.off = String(!enabled);
    el.btnMicLabel.textContent = enabled ? 'Mikrofon aktif' : 'Mikrofon mati';
  }

  async function toggleCam(): Promise<void> {
    if (!room) return;
    const enabled = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(enabled);
    el.btnCam.dataset.off = String(!enabled);
    el.btnCamLabel.textContent = enabled ? 'Kamera aktif' : 'Kamera mati';
  }

  /**
   * Start or stop sharing this guest's screen.
   *
   * The published track is a second video publication, not a replacement for the
   * camera: the captain's scene has a separate browser source for it and composes the
   * two itself. `Track.Source.ScreenShare` is what keeps them apart, all the way to
   * `src/lib/view-source.ts`.
   *
   * Screen encoding is its own policy - see PUBLISH_SCREEN_PRESET in
   * src/lib/quality.ts. Note `screenShareEncoding` rather than `videoEncoding`:
   * livekit reads a different field for a screen track and would silently ignore the
   * other one. A single entry in `screenShareSimulcastLayers` yields two layers in
   * total, the on-air one and the grid one, with no middle layer encoded for nobody.
   */
  async function toggleScreen(): Promise<void> {
    if (!room) return;
    const wanted = !room.localParticipant.isScreenShareEnabled;
    el.btnScreen.disabled = true;
    el.screenError.hidden = true;
    try {
      await room.localParticipant.setScreenShareEnabled(
        wanted,
        {
          resolution: PUBLISH_SCREEN_PRESET.resolution,
          contentHint: PUBLISH_SCREEN_PRESET.contentHint,
          // Capturing the shared audio is a deliberate yes: playing a clip on air is
          // part of the show. The browser's three voice processors stay off - see
          // PUBLISH_SCREEN_AUDIO_PRESET - and suppressLocalAudioPlayback keeps that
          // audio out of the sharer's own speakers, which is the one feedback path
          // this page can close by itself.
          audio: { ...PUBLISH_SCREEN_AUDIO_PRESET.capture },
          suppressLocalAudioPlayback: PUBLISH_SCREEN_PRESET.suppressLocalAudioPlayback,
          // Offer the guest every source Chrome can give: a tab, a window, a whole
          // display, the system-audio checkbox, and the ability to switch what they are
          // sharing without stopping and starting again.
          systemAudio: 'include',
          surfaceSwitching: 'include',
        },
        {
          simulcast: PUBLISH_SCREEN_PRESET.simulcast,
          videoCodec: 'vp8',
          screenShareEncoding: { ...PUBLISH_SCREEN_PRESET.top.encoding },
          screenShareSimulcastLayers: [PUBLISH_SCREEN_PRESET.low],
          audioPreset: { maxBitrate: PUBLISH_SCREEN_AUDIO_PRESET.maxBitrate },
          dtx: PUBLISH_SCREEN_AUDIO_PRESET.dtx,
          red: PUBLISH_SCREEN_AUDIO_PRESET.red,
        },
      );
    } catch (error) {
      const message = classifyScreenShareError(error);
      el.screenError.hidden = message === null;
      el.screenError.textContent = message ?? '';
    } finally {
      el.btnScreen.disabled = false;
      // Read the room back rather than assuming `wanted` took effect: a guest who
      // closed the picker is still not sharing.
      paintScreenButton();
    }
  }

  /**
   * Reflect whether this guest is sharing.
   *
   * Driven by the room's own state, not by what the button last did, because the guest
   * can stop a share from Chrome's own stop-sharing bar and never touch this button.
   * livekit unpublishes the track when the underlying capture ends, which fires
   * LocalTrackUnpublished; that is the event that keeps this honest.
   */
  function paintScreenButton(): void {
    const sharing = room?.localParticipant.isScreenShareEnabled ?? false;
    el.btnScreen.dataset.active = String(sharing);
    el.btnScreenLabel.textContent = sharing ? 'Layar dibagikan' : 'Bagikan layar';
  }

  async function leave(): Promise<void> {
    await room?.disconnect();
    window.location.reload();
  }

  // ---------- in-room device switching ----------

  function toggleDevicesPop(): void {
    const show = el.devicesPop.hidden;
    if (show) void refreshRoomDeviceLists();
    el.devicesPop.hidden = !show;
    el.btnDevices.dataset.active = String(show);
  }

  function closeDevicesPop(): void {
    el.devicesPop.hidden = true;
    el.btnDevices.dataset.active = 'false';
  }

  /**
   * The id the picker should mark as active for a local input.
   *
   * `getActiveDevice` starts as the placeholder 'default' before any switch, which
   * for cameras is not a real Chrome device id, so the published track's own
   * settings are the source of truth until a switch has recorded a concrete id.
   * After a switch-while-muted the map is ahead of the (stopped) track, which is
   * exactly when the map must win.
   */
  function activeInputId(kind: 'videoinput' | 'audioinput', source: Track.Source): string | undefined {
    const fromRoom = room?.getActiveDevice(kind);
    if (fromRoom && fromRoom !== 'default') return fromRoom;
    const publication = room?.localParticipant.getTrackPublication(source);
    return publication?.track?.mediaStreamTrack.getSettings().deviceId ?? fromRoom;
  }

  async function refreshRoomDeviceLists(): Promise<void> {
    if (!room) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const camId = activeInputId('videoinput', Track.Source.Camera);
    const micId = activeInputId('audioinput', Track.Source.Microphone);
    renderSelect(el.selectCameraRoom, deviceOptions(devices, 'videoinput', camId, 'Kamera'));
    renderSelect(el.selectMicRoom, deviceOptions(devices, 'audioinput', micId, 'Mikrofon'));

    const offerSpeaker = offerSpeakerPicker(supportsAudioOutputSelection(), devices);
    el.fieldSpeakerRoom.hidden = !offerSpeaker;
    if (offerSpeaker) {
      const outId =
        room.getActiveDevice('audiooutput') ?? resolveActiveDevice(speakerId, devices, 'audiooutput');
      renderSelect(el.selectSpeakerRoom, deviceOptions(devices, 'audiooutput', outId, 'Speaker'));
    }
  }

  /**
   * All three kinds go through Room.switchActiveDevice: it swaps the device inside
   * the live publication (the track and its sid survive, so OBS never reloads),
   * defers the swap when the track is muted, and for outputs re-sinks every remote
   * audio element, current and future.
   */
  async function switchRoomDevice(kind: MediaDeviceKind, deviceId: string, label: string): Promise<void> {
    if (!room) return;
    el.devicesError.hidden = true;
    try {
      await room.switchActiveDevice(kind, deviceId);
      if (kind === 'audiooutput') speakerId = deviceId;
    } catch (error) {
      el.devicesError.hidden = false;
      el.devicesError.textContent = `Tidak bisa pindah ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      // Re-read reality so the picker does not claim a device that never took over.
      void refreshRoomDeviceLists();
    }
  }

  // ---------- wiring ----------

  el.btnPermission.addEventListener('click', () => void requestMedia());
  el.btnRetry.addEventListener('click', () => void requestMedia());
  el.btnRetryDevice.addEventListener('click', () => void requestMedia());
  el.btnJoin.addEventListener('click', () => void join());
  el.selectCamera.addEventListener('change', () => void switchCamera(el.selectCamera.value));
  el.selectMic.addEventListener('change', () => void switchMic(el.selectMic.value));
  el.selectSpeaker.addEventListener('change', () => {
    speakerId = el.selectSpeaker.value;
  });
  el.btnMic.addEventListener('click', () => void toggleMic());
  el.btnCam.addEventListener('click', () => void toggleCam());
  el.btnScreen.addEventListener('click', () => void toggleScreen());
  el.btnDevices.addEventListener('click', () => toggleDevicesPop());
  // startAudio must be called from a real user gesture, which is exactly what this
  // click is. The status event then hides the notice.
  el.audioBlocked.addEventListener('click', () => {
    void room?.startAudio().catch(() => undefined);
  });
  el.btnLeave.addEventListener('click', () => void leave());
  el.selectCameraRoom.addEventListener('change', () =>
    void switchRoomDevice('videoinput', el.selectCameraRoom.value, 'kamera'),
  );
  el.selectMicRoom.addEventListener('change', () =>
    void switchRoomDevice('audioinput', el.selectMicRoom.value, 'mikrofon'),
  );
  el.selectSpeakerRoom.addEventListener('change', () =>
    void switchRoomDevice('audiooutput', el.selectSpeakerRoom.value, 'speaker'),
  );

  // Click-away closes the popover; clicks inside it or on its button do not.
  document.addEventListener('click', (event) => {
    if (el.devicesPop.hidden) return;
    const target = event.target as Node;
    if (!el.devicesPop.contains(target) && !el.btnDevices.contains(target)) {
      closeDevicesPop();
    }
  });

  // Hot-plug is the normal case: a guest plugs in their headset after the page
  // loaded. Refresh whichever pickers are on screen. In-room, livekit-client has
  // its own devicechange handling (it even falls back to the first output when the
  // active speaker vanishes); this listener only keeps the visible lists truthful.
  navigator.mediaDevices.addEventListener?.('devicechange', () => {
    if (room) {
      if (!el.devicesPop.hidden) void refreshRoomDeviceLists();
    } else if (!el.panels.ready.hidden) {
      void populateDeviceLists();
    }
  });

  // Guests close the tab rather than pressing Keluar. Leaving cleanly means the
  // others' grids drop the tile immediately instead of after a timeout.
  window.addEventListener('pagehide', () => {
    void room?.disconnect();
  });

  // The no-overflow guarantee depends on the viewport, so recompute on resize.
  window.addEventListener('resize', () => {
    if (room) renderGrid();
  });

  // Exposed for the local end-to-end checks in the README.
  (window as unknown as Record<string, unknown>).__ngobrolin = {
    roomName: ROOM_NAME,
    getRoom: () => room,
  };
}

function need<T extends Element>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as unknown as T;
}

function collectElements() {
  return {
    stageJoin: need<HTMLElement>('stage-join'),
    stageRoom: need<HTMLElement>('stage-room'),
    previewVideo: need<HTMLVideoElement>('preview-video'),
    previewPlaceholder: need<HTMLElement>('preview-placeholder'),
    previewCaption: need<HTMLElement>('preview-caption'),
    inputName: need<HTMLInputElement>('input-name'),
    selectCamera: need<HTMLSelectElement>('select-camera'),
    selectMic: need<HTMLSelectElement>('select-mic'),
    selectSpeaker: need<HTMLSelectElement>('select-speaker'),
    fieldSpeaker: need<HTMLElement>('field-speaker'),
    meterFill: need<HTMLElement>('meter-fill'),
    joinError: need<HTMLElement>('join-error'),
    fatalTitle: need<HTMLElement>('fatal-title'),
    fatalBody: need<HTMLElement>('fatal-body'),
    btnPermission: need<HTMLButtonElement>('btn-permission'),
    btnRetry: need<HTMLButtonElement>('btn-retry'),
    btnRetryDevice: need<HTMLButtonElement>('btn-retry-device'),
    btnJoin: need<HTMLButtonElement>('btn-join'),
    btnMic: need<HTMLButtonElement>('btn-mic'),
    btnMicLabel: need<HTMLElement>('btn-mic-label'),
    btnCam: need<HTMLButtonElement>('btn-cam'),
    btnCamLabel: need<HTMLElement>('btn-cam-label'),
    btnScreen: need<HTMLButtonElement>('btn-screen'),
    btnScreenLabel: need<HTMLElement>('btn-screen-label'),
    screenError: need<HTMLElement>('screen-error'),
    btnLeave: need<HTMLButtonElement>('btn-leave'),
    btnDevices: need<HTMLButtonElement>('btn-devices'),
    devicesPop: need<HTMLElement>('devices-pop'),
    devicesError: need<HTMLElement>('devices-error'),
    selectCameraRoom: need<HTMLSelectElement>('select-camera-room'),
    selectMicRoom: need<HTMLSelectElement>('select-mic-room'),
    selectSpeakerRoom: need<HTMLSelectElement>('select-speaker-room'),
    fieldSpeakerRoom: need<HTMLElement>('field-speaker-room'),
    grid: need<HTMLElement>('grid'),
    roomStatus: need<HTMLElement>('room-status'),
    audioBlocked: need<HTMLButtonElement>('audio-blocked'),
    panels: {
      permission: need<HTMLElement>('panel-permission'),
      denied: need<HTMLElement>('panel-denied'),
      nodevice: need<HTMLElement>('panel-nodevice'),
      ready: need<HTMLElement>('panel-ready'),
      fatal: need<HTMLElement>('panel-fatal'),
    } satisfies Record<Panel, HTMLElement>,
  };
}
