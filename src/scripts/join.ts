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
  type Participant,
  type RemoteParticipant,
} from 'livekit-client';

import { connectionStatus } from '../lib/connection-status.ts';
import { ROOM_NAME } from '../lib/identity.ts';
import { gridColumns, orderTiles, tileWidth } from '../lib/layout.ts';
import { classifyJoinFailure, classifyMediaError } from '../lib/media-errors.ts';
import {
  AUDIO_CAPTURE_CONSTRAINTS,
  PUBLISH_AUDIO_PRESET,
  PUBLISH_VIDEO_PRESET,
  subscriptionQualityFor,
} from '../lib/quality.ts';
import { decodeTokenPayload } from '../lib/jwt.ts';

const LIVEKIT_URL = import.meta.env.PUBLIC_LIVEKIT_URL as string | undefined;

type Panel = 'permission' | 'denied' | 'nodevice' | 'ready' | 'fatal';

interface PreviewState {
  video: LocalVideoTrack | null;
  audio: LocalAudioTrack | null;
}

export function startJoinPage(): void {
  const el = collectElements();
  const preview: PreviewState = { video: null, audio: null };
  let room: Room | null = null;
  let meterStop: (() => void) | null = null;

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
      startMeter(audio);
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
    fillSelect(el.selectCamera, devices, 'videoinput', preview.video?.mediaStreamTrack, 'Kamera');
    fillSelect(el.selectMic, devices, 'audioinput', preview.audio?.mediaStreamTrack, 'Mikrofon');
  }

  function fillSelect(
    select: HTMLSelectElement,
    devices: MediaDeviceInfo[],
    kind: MediaDeviceKind,
    active: MediaStreamTrack | undefined,
    fallbackLabel: string,
  ): void {
    const activeId = active?.getSettings().deviceId;
    select.replaceChildren();
    devices
      .filter((device) => device.kind === kind)
      .forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
        option.selected = device.deviceId === activeId;
        select.append(option);
      });
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
      await preview.audio.setDeviceId(deviceId);
      startMeter(preview.audio);
    } catch (error) {
      showError(`Tidak bisa pindah mikrofon: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---------- microphone level meter ----------

  function startMeter(audio: LocalAudioTrack): void {
    meterStop?.();
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([audio.mediaStreamTrack]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const tick = (): void => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (const sample of buffer) {
        peak = Math.max(peak, Math.abs(sample - 128) / 128);
      }
      // Speech peaks well below full scale, so scale up before clamping. This bar is
      // a "your mic is alive" signal, not a calibrated meter.
      el.meterFill.style.width = `${Math.min(100, Math.round(peak * 220))}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    meterStop = () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void context.close();
      el.meterFill.style.width = '0%';
      meterStop = null;
    };
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

      meterStop?.();
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
      .on(RoomEvent.LocalTrackPublished, rerender)
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
   * Ask the SFU for the smallest layer of every remote camera.
   *
   * OBS is the only consumer that needs full resolution. Doing this on every
   * subscription is what keeps a five-person room from costing each guest four
   * simultaneous 720p downstreams.
   */
  function applyGridQuality(publication: RemoteTrackPublication): void {
    if (publication.kind !== Track.Kind.Video) return;
    const { quality, dimensions } = subscriptionQualityFor('grid');
    publication.setVideoQuality(quality);
    publication.setVideoDimensions(dimensions);
  }

  // ---------- grid rendering ----------

  function renderGrid(): void {
    if (!room) return;
    const participants: Participant[] = [
      ...(Array.from(room.remoteParticipants.values()) as RemoteParticipant[]),
      room.localParticipant,
    ];

    const tiles = orderTiles(
      participants.map((participant) => ({
        identity: participant.identity,
        isLocal: participant === room!.localParticipant,
        participant,
      })),
    );

    sizeGrid(tiles.length);

    const seen = new Set<string>();
    for (const tile of tiles) {
      seen.add(tile.identity);
      renderTile(tile.identity, tile.participant, tile.isLocal);
    }
    for (const node of Array.from(el.grid.children) as HTMLElement[]) {
      if (!seen.has(node.dataset.identity ?? '')) node.remove();
    }
    // Re-append in order so DOM order matches the intended tile order.
    for (const tile of tiles) {
      const node = el.grid.querySelector<HTMLElement>(`[data-identity="${cssEscape(tile.identity)}"]`);
      if (node) el.grid.append(node);
    }
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

  function renderTile(identity: string, participant: Participant, isLocal: boolean): void {
    let node = el.grid.querySelector<HTMLElement>(`[data-identity="${cssEscape(identity)}"]`);
    if (!node) {
      node = document.createElement('div');
      node.className = 'tile';
      node.dataset.identity = identity;
      node.innerHTML = `
        <div class="tile-avatar"></div>
        <video autoplay playsinline></video>
        <span class="tile-name"></span>
        <span class="tile-muted" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3l18 18M9 9v3a3 3 0 0 0 4.5 2.6M15 11V5a3 3 0 0 0-6-.6M5 11a7 7 0 0 0 10.3 6.2M12 18v4" />
          </svg>
        </span>`;
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

  async function leave(): Promise<void> {
    await room?.disconnect();
    window.location.reload();
  }

  // ---------- wiring ----------

  el.btnPermission.addEventListener('click', () => void requestMedia());
  el.btnRetry.addEventListener('click', () => void requestMedia());
  el.btnRetryDevice.addEventListener('click', () => void requestMedia());
  el.btnJoin.addEventListener('click', () => void join());
  el.selectCamera.addEventListener('change', () => void switchCamera(el.selectCamera.value));
  el.selectMic.addEventListener('change', () => void switchMic(el.selectMic.value));
  el.btnMic.addEventListener('click', () => void toggleMic());
  el.btnCam.addEventListener('click', () => void toggleCam());
  el.btnLeave.addEventListener('click', () => void leave());

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
    btnLeave: need<HTMLButtonElement>('btn-leave'),
    grid: need<HTMLElement>('grid'),
    roomStatus: need<HTMLElement>('room-status'),
    panels: {
      permission: need<HTMLElement>('panel-permission'),
      denied: need<HTMLElement>('panel-denied'),
      nodevice: need<HTMLElement>('panel-nodevice'),
      ready: need<HTMLElement>('panel-ready'),
      fatal: need<HTMLElement>('panel-fatal'),
    } satisfies Record<Panel, HTMLElement>,
  };
}
