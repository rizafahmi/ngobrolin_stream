/**
 * The composition rule: what the room looks like right now.
 *
 * This is the brain of the presentation layer, and it is deliberately a pure function
 * of room state. There is no director, no control plane, no data channel and no
 * backend: somebody is sharing, so their screen takes the stage and the faces become a
 * filmstrip; nobody is sharing, so it is the even grid this project already had.
 *
 * **Both renders call this.** The composed OBS browser source and every guest's own
 * page ask the same question of the same function, which is what makes "what goes on
 * air is what the participants see" a property of the code rather than a promise. The
 * two differ in how they *draw* the answer - OBS letterboxes a fixed 1920x1080 canvas
 * and carries nothing but video, a guest's page is responsive and keeps its name
 * labels and its audio - but never in what the answer is.
 *
 * The mode is a parameter rather than a caller's private business for one reason:
 * whether audio exists at all is part of the composition. The captain mixes per-guest
 * audio in OBS with individual faders, so one composed audio leg arriving alongside
 * would wreck that mix. `renderAcceptsTrackSource` puts that rule at the *subscription*
 * filter, where an audio track cannot reach OBS even by accident.
 *
 * No livekit-client import, deliberately, same as `layout.ts` and `view-source.ts`:
 * this is testable without a browser, and it is where all the fiddly cases live.
 */

import { gridColumns, gridRows, orderTiles, tileWidth } from './layout.ts';

/** Which of the two renders is asking. */
export type RenderMode = 'obs' | 'app';

/** What a cell shows. A face or a shared screen; there is no third thing. */
export type CellKind = 'camera' | 'screen';

/**
 * Where a cell sits in the composition, which is what decides its subscription.
 *
 * - `stage`     - the one large element, only ever a shared screen.
 * - `filmstrip` - a small face (or a second, not-on-stage screen) beside the stage.
 * - `even`      - a cell of the even grid, which is the layout when nobody shares.
 */
export type StageSlot = 'stage' | 'filmstrip' | 'even';

export type StageLayout = 'grid' | 'presentation';

/** The room state the composition is derived from. Nothing else is consulted. */
export interface CompositionParticipant {
  identity: string;
  isLocal: boolean;
  /** True when this participant has a live screen-share publication right now. */
  sharing: boolean;
}

export interface StageCell {
  /** Unique per cell: `<identity>` for a face, `<identity>.screen` for a screen. */
  key: string;
  kind: CellKind;
  identity: string;
  isLocal: boolean;
  slot: StageSlot;
}

export interface Composition {
  mode: RenderMode;
  layout: StageLayout;
  /** The one element on stage, or null when nobody is sharing. */
  stage: StageCell | null;
  /** Everything else, in render order: the filmstrip, or the whole even grid. */
  filmstrip: StageCell[];
  /**
   * Whether this render attaches audio at all.
   *
   * Always false for OBS. This is not a rendering preference, it is the guarantee that
   * the captain's per-guest faders keep working, and it is enforced again at the
   * subscription filter so no audio track is even pulled down.
   */
  audio: boolean;
}

/** The suffix that turns a participant identity into their screen cell's key. */
const SCREEN_KEY_SUFFIX = '.screen';

/** Every cell in the composition, stage first. */
export function cells(composition: Composition): StageCell[] {
  return composition.stage ? [composition.stage, ...composition.filmstrip] : composition.filmstrip;
}

/**
 * Work out the arrangement.
 *
 * Exactly one screen is ever on stage. When two guests share at once the tie is broken
 * on **identity**, not on join order and not on who is local, because two viewers
 * disagreeing about which screen is the big one would be worse than either choice. The
 * loser's screen is not hidden - it becomes a filmstrip cell beside its owner's face,
 * so it is visibly present and can be seen to be the one that is not on air.
 *
 * The sharer gets their own screen on stage like everybody else. Sharing a whole
 * display makes a tunnel of it; that artifact is worth far less than a guest being able
 * to confirm what is actually going out, which is the failure this feature exists for.
 */
export function compose(participants: CompositionParticipant[], mode: RenderMode): Composition {
  const audio = mode === 'app';

  const onStageIdentity = [...participants]
    .filter((p) => p.sharing)
    .map((p) => p.identity)
    .sort((a, b) => a.localeCompare(b))
    .at(0);

  if (onStageIdentity === undefined) {
    return {
      mode,
      layout: 'grid',
      stage: null,
      filmstrip: order(participants.map((p) => cameraCell(p, 'even'))),
      audio,
    };
  }

  const sharer = participants.find((p) => p.identity === onStageIdentity)!;
  const rest: StageCell[] = [];
  for (const participant of participants) {
    rest.push(cameraCell(participant, 'filmstrip'));
    // The second share, if there is one. It sits directly after its owner's face, which
    // is where the key sort puts it anyway, so the two read as one person's cells.
    if (participant.sharing && participant.identity !== onStageIdentity) {
      rest.push(screenCell(participant, 'filmstrip'));
    }
  }

  return {
    mode,
    layout: 'presentation',
    stage: screenCell(sharer, 'stage'),
    filmstrip: order(rest),
    audio,
  };
}

function cameraCell(participant: CompositionParticipant, slot: StageSlot): StageCell {
  return {
    key: participant.identity,
    kind: 'camera',
    identity: participant.identity,
    isLocal: participant.isLocal,
    slot,
  };
}

function screenCell(participant: CompositionParticipant, slot: StageSlot): StageCell {
  return {
    key: `${participant.identity}${SCREEN_KEY_SUFFIX}`,
    kind: 'screen',
    identity: participant.identity,
    isLocal: participant.isLocal,
    slot,
  };
}

/**
 * Remote cells sorted by key, the local guest's own cells last.
 *
 * Reuses the room grid's ordering rule so the filmstrip and the even grid put people in
 * the same places: a guest whose neighbour is on their right during the conversation
 * should not find them somewhere else the moment somebody shares a slide.
 */
function order(list: StageCell[]): StageCell[] {
  // Ordered by cell key rather than by participant identity, which is the same thing
  // for a face and puts a screen immediately after the face it belongs to.
  return orderTiles(list.map((cell) => ({ identity: cell.key, isLocal: cell.isLocal, cell }))).map(
    (entry) => entry.cell,
  );
}

/**
 * `Track.Source` values a render subscribes to, as plain strings.
 *
 * The composed OBS source takes **video only**. That is decision, not omission: the
 * captain's mix is per-guest faders, and a single composed audio leg would either
 * duplicate every voice or replace the faders with nothing. Enforcing it here rather
 * than at attach time means the track is never even pulled down, so it also cannot be
 * revived by a future change to how the page draws things.
 *
 * The app render is unchanged from what a guest hears today, screen-share audio
 * included: a guest discussing a clip they cannot hear is the worse failure.
 *
 * The strings are livekit's `Track.Source` values; test/stage.test.ts pins them against
 * the real enum so the two cannot drift apart.
 */
const ACCEPTED_TRACK_SOURCES: Record<RenderMode, readonly string[]> = {
  obs: ['camera', 'screen_share'],
  app: ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
};

export function renderAcceptsTrackSource(mode: RenderMode, trackSource: string): boolean {
  return ACCEPTED_TRACK_SOURCES[mode].includes(trackSource);
}

// ---------- geometry ----------

/**
 * The canvas the composed OBS source is drawn on.
 *
 * Fixed rather than responsive, because the captain sets the browser source to exactly
 * this and everything downstream - the scene, the overlays, the recording - is built on
 * 1920x1080. The page's background is transparent so the captain's existing background
 * and overlay stack still shows through around the composition.
 */
export const OBS_CANVAS = { width: 1920, height: 1080 } as const;

/** Gap between the stage and the filmstrip, and between filmstrip cells, in px. */
export const STAGE_GAP = 12;

/**
 * Ceiling on a filmstrip face.
 *
 * 360px on a 1920 canvas leaves the stage 1548px, which is where the whole feature
 * pays off: a 1280x720 screen publish renders at 1548px with only a modest upscale,
 * where the same screen in the old even grid was a 500px cell nobody could read.
 * Bigger faces would buy nothing on air and would eat the stage.
 */
export const FILMSTRIP_MAX_WIDTH = 360;

/**
 * Share of the width the filmstrip may take before the cap above bites.
 *
 * A flat 360px is right for the 1920 broadcast canvas and wrong for a guest's window:
 * on a 900px laptop it would be 40% of the page, and the screen - the one thing this
 * layout exists to make readable - would be the smaller half of it.
 */
const FILMSTRIP_WIDTH_SHARE = 0.2;

/** Floor on a filmstrip face, so a cramped window shrinks the strip without erasing it. */
export const FILMSTRIP_MIN_WIDTH = 120;

/**
 * Below this the filmstrip moves from a right-hand column to a row under the stage.
 *
 * Only the app render can be this narrow. On a small laptop window a column would take
 * a third of the width and leave the screen unreadable, which is the one thing this
 * layout exists to prevent.
 */
export const FILMSTRIP_COLUMN_MIN_WIDTH = 760;

/**
 * Ceiling on an even-grid cell in the *composed* render.
 *
 * Not the room grid's 560px, which is a "do not fill a laptop with one face" rule. Here
 * the useful cap is the width at which the 360p simulcast layer stops covering the
 * cell, because that is the layer the composed source subscribes faces at. At every
 * plausible room size this lands the cell between 632 and 640px, so 640x360 is close to
 * an exact match and the composed source costs a fifth of a second full copy of every
 * camera. A single guest wanting the whole frame is what the per-guest source is for.
 */
export const OBS_GRID_MAX_TILE_WIDTH = 640;

/** 16:9, the shape everything in this system publishes and renders. */
const ASPECT = 16 / 9;

export interface PresentationLayout {
  /** Where the filmstrip runs: down the right of the stage, or along the bottom. */
  orientation: 'column' | 'row';
  /** Box the on-stage element gets. It letterboxes inside; a screen is never cropped. */
  stage: { width: number; height: number };
  filmstrip: {
    /** The strip's cross-axis size: its width as a column, its height as a row. */
    width: number;
    height: number;
    /** Width of one filmstrip cell. Zero when there is nobody in the strip. */
    tileWidth: number;
  };
}

/**
 * Split an area into a stage box and a filmstrip.
 *
 * The stage is given everything the filmstrip does not need, and the filmstrip is sized
 * from its cell count rather than from a fraction of the area: with the cells capped at
 * {@link FILMSTRIP_MAX_WIDTH} the strip only grows narrower as more people join, never
 * wider, so the stage never shrinks below what it is worth.
 *
 * The caller letterboxes the on-stage element inside `stage` with `object-fit: contain`.
 * A shared screen must never be cropped: the edge of a shared window is usually the
 * thing being pointed at.
 */
export function presentationLayout(
  available: { width: number; height: number },
  filmstripCount: number,
  gap: number = STAGE_GAP,
): PresentationLayout {
  const orientation = available.width >= FILMSTRIP_COLUMN_MIN_WIDTH ? 'column' : 'row';

  if (filmstripCount <= 0) {
    return {
      orientation,
      stage: { width: available.width, height: available.height },
      filmstrip: { width: 0, height: 0, tileWidth: 0 },
    };
  }

  const spread = gap * (filmstripCount - 1);

  // How wide a face may get here: a share of the area, never more than the cap, and
  // never below the floor - a strip too small to recognise a face in is not a strip.
  const cap = Math.max(
    FILMSTRIP_MIN_WIDTH,
    Math.min(FILMSTRIP_MAX_WIDTH, available.width * FILMSTRIP_WIDTH_SHARE),
  );

  if (orientation === 'column') {
    // Bounded by the height it has to stack into, and by the cap.
    const byHeight = ((available.height - spread) / filmstripCount) * ASPECT;
    const tile = clampTile(Math.min(cap, byHeight), available.width);
    return {
      orientation,
      stage: { width: Math.max(1, available.width - tile - gap), height: available.height },
      filmstrip: { width: tile, height: available.height, tileWidth: tile },
    };
  }

  // Bounded by the width it has to lay out across. The share cap does not apply along
  // this axis - a row of faces is bounded by the width it has to divide, not by a
  // fraction of it - but the ceiling still does.
  const byWidth = (available.width - spread) / filmstripCount;
  const tile = clampTile(Math.min(FILMSTRIP_MAX_WIDTH, byWidth), available.width);
  const stripHeight = Math.floor(tile / ASPECT);
  return {
    orientation,
    stage: { width: available.width, height: Math.max(1, available.height - stripHeight - gap) },
    filmstrip: { width: available.width, height: stripHeight, tileWidth: tile },
  };
}

/** Floor keeps sub-pixel rounding from pushing the last cell over the edge. */
function clampTile(size: number, availableWidth: number): number {
  return Math.max(1, Math.min(Math.floor(size), Math.floor(availableWidth)));
}

/** One cell's box within the render area, in px from the area's top left. */
export interface CellBox extends StageCell {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LayoutOptions {
  gap?: number;
  /** Ceiling on an even-grid cell. The two renders want different ones. */
  maxTileWidth?: number;
}

/**
 * Place every cell of a composition.
 *
 * Both renders position their cells absolutely from this, which buys two things. The
 * arrangement is identical rather than merely similar, since there is one implementation
 * of it. And a cell that changes slot - a face demoted from the even grid to the
 * filmstrip when somebody starts sharing - is the *same element moving*, so the video
 * track is never re-attached and never flashes.
 *
 * Boxes are guaranteed to sit inside the area, never to overlap, and to be 16:9 except
 * for the stage, which is a container the on-stage element letterboxes inside.
 */
export function layoutCells(
  composition: Composition,
  area: { width: number; height: number },
  options: LayoutOptions = {},
): CellBox[] {
  const gap = options.gap ?? STAGE_GAP;

  if (!composition.stage) {
    return evenGridBoxes(composition.filmstrip, area, gap, options.maxTileWidth);
  }

  const layout = presentationLayout(area, composition.filmstrip.length, gap);
  const boxes: CellBox[] = [
    {
      ...composition.stage,
      left: 0,
      top: 0,
      width: layout.stage.width,
      height: layout.stage.height,
    },
  ];

  const count = composition.filmstrip.length;
  const tile = layout.filmstrip.tileWidth;
  const tileHeight = Math.max(1, Math.floor(tile / ASPECT));

  if (layout.orientation === 'column') {
    // Stacked down the right of the stage, centred in the height they have.
    const stacked = count * tileHeight + gap * (count - 1);
    const startTop = Math.max(0, Math.floor((area.height - stacked) / 2));
    const left = area.width - tile;
    composition.filmstrip.forEach((cell, index) => {
      boxes.push({
        ...cell,
        left,
        top: startTop + index * (tileHeight + gap),
        width: tile,
        height: tileHeight,
      });
    });
    return boxes;
  }

  // Laid out under the stage, centred in the width they have.
  const spread = count * tile + gap * (count - 1);
  const startLeft = Math.max(0, Math.floor((area.width - spread) / 2));
  const top = area.height - tileHeight;
  composition.filmstrip.forEach((cell, index) => {
    boxes.push({
      ...cell,
      left: startLeft + index * (tile + gap),
      top,
      width: tile,
      height: tileHeight,
    });
  });
  return boxes;
}

/**
 * The even grid, centred both ways.
 *
 * Row by row rather than as one block, so a last row with a gap in it - four guests in
 * a 3-column layout, say - is centred on its own rather than left hanging off one side.
 * The canvas is transparent and the captain composites a background under it, so an
 * arrangement hugging a corner would read as a mistake on air.
 */
function evenGridBoxes(
  list: StageCell[],
  area: { width: number; height: number },
  gap: number,
  maxTileWidth?: number,
): CellBox[] {
  if (list.length === 0) return [];

  const cols = gridColumns(list.length);
  const rows = gridRows(list.length);
  const size = tileWidth(list.length, area.width, area.height, maxTileWidth);
  const tileHeight = Math.max(1, Math.floor(size / ASPECT));
  const startTop = Math.max(0, Math.floor((area.height - (rows * tileHeight + gap * (rows - 1))) / 2));

  return list.map((cell, index) => {
    const row = Math.floor(index / cols);
    const column = index % cols;
    const inRow = Math.min(cols, list.length - row * cols);
    const rowWidth = inRow * size + gap * (inRow - 1);
    return {
      ...cell,
      left: Math.max(0, Math.floor((area.width - rowWidth) / 2)) + column * (size + gap),
      top: startTop + row * (tileHeight + gap),
      width: size,
      height: tileHeight,
    };
  });
}
