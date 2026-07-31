/**
 * The composition rule.
 *
 * This is the whole presentation layer's brain: given who is in the room, who is
 * sharing, and which of the two renders is asking, it returns the arrangement. Both
 * renders call it, which is what makes "what goes on air is what the participants see"
 * a property of the code rather than a promise in a README.
 *
 * The two things worth being paranoid about are here:
 *
 * - **Determinism.** Two guests sharing at once must not give two viewers two different
 *   pictures. The tie is broken on identity, never on join order or on who is local.
 * - **The OBS render carries no audio at all.** The captain mixes per-guest audio with
 *   individual faders, and one composed audio leg arriving in OBS would wreck that.
 *   That is enforced at the subscription filter, not just at attach time.
 */
import { describe, expect, it } from 'vitest';
import { Track } from 'livekit-client';
import {
  FILMSTRIP_MAX_WIDTH,
  FILMSTRIP_MIN_WIDTH,
  OBS_CANVAS,
  OBS_GRID_MAX_TILE_WIDTH,
  STAGE_GAP,
  cells,
  compose,
  layoutCells,
  presentationLayout,
  renderAcceptsTrackSource,
  type Composition,
  type CompositionParticipant,
  type RenderMode,
} from '../src/lib/stage.ts';
import { GRID_GAP, gridColumns, gridRows, tileWidth } from '../src/lib/layout.ts';

const guest = (identity: string, extra: Partial<CompositionParticipant> = {}): CompositionParticipant => ({
  identity,
  isLocal: false,
  sharing: false,
  ...extra,
});

/** The real show shape: three guests, one of them looking at their own page. */
const THREE = [guest('andre'), guest('budi'), guest('sari', { isLocal: true })];

describe('compose - nobody sharing', () => {
  it('is the even grid this project already had', () => {
    const composition = compose(THREE, 'app');
    expect(composition.layout).toBe('grid');
    expect(composition.stage).toBeNull();
    expect(composition.filmstrip.map((c) => c.key)).toEqual(['andre', 'budi', 'sari']);
  });

  it('marks every cell as an even-grid cell, not a filmstrip one', () => {
    for (const cell of cells(compose(THREE, 'obs'))) {
      expect(cell.slot).toBe('even');
    }
  });

  it('keeps the local guest last, as the room grid always has', () => {
    expect(compose(THREE, 'app').filmstrip.at(-1)?.isLocal).toBe(true);
  });

  it('has one cell per participant and no screen cells at all', () => {
    const composition = compose(THREE, 'app');
    expect(composition.filmstrip).toHaveLength(3);
    expect(composition.filmstrip.every((c) => c.kind === 'camera')).toBe(true);
  });

  it('renders an empty room without inventing a stage', () => {
    const composition = compose([], 'obs');
    expect(composition.layout).toBe('grid');
    expect(composition.stage).toBeNull();
    expect(composition.filmstrip).toEqual([]);
  });
});

describe('compose - somebody sharing', () => {
  const sharing = [guest('andre'), guest('budi', { sharing: true }), guest('sari', { isLocal: true })];

  it('puts the shared screen on stage and demotes the faces to a filmstrip', () => {
    const composition = compose(sharing, 'app');
    expect(composition.layout).toBe('presentation');
    expect(composition.stage).toMatchObject({ key: 'budi.screen', kind: 'screen', slot: 'stage' });
    expect(composition.filmstrip.map((c) => c.key)).toEqual(['andre', 'budi', 'sari']);
    expect(composition.filmstrip.every((c) => c.slot === 'filmstrip')).toBe(true);
  });

  it('still shows the sharer their own face in the filmstrip', () => {
    const composition = compose(sharing, 'app');
    expect(composition.filmstrip.some((c) => c.identity === 'budi' && c.kind === 'camera')).toBe(true);
  });

  /**
   * The reason this feature exists. A guest sharing used to get no view of their own
   * screen at all, so they could not tell what was going out. Sharing a whole display
   * makes a tunnel of the stage; that artifact is worth less than the confirmation.
   */
  it('shows the sharer their own screen on stage when the sharer is the local guest', () => {
    const composition = compose(
      [guest('andre'), guest('sari', { isLocal: true, sharing: true })],
      'app',
    );
    expect(composition.stage).toMatchObject({ key: 'sari.screen', isLocal: true, slot: 'stage' });
  });

  it('gives OBS and the app the identical arrangement', () => {
    const obs = compose(sharing, 'obs');
    const app = compose(sharing, 'app');
    expect(cells(obs).map((c) => `${c.key}:${c.slot}`)).toEqual(
      cells(app).map((c) => `${c.key}:${c.slot}`),
    );
  });
});

describe('compose - two guests sharing at once', () => {
  const both = [
    guest('sari', { sharing: true }),
    guest('andre', { sharing: true }),
    guest('budi', { isLocal: true }),
  ];

  it('puts exactly one screen on stage', () => {
    const composition = compose(both, 'obs');
    expect(composition.stage?.key).toBe('andre.screen');
    expect(cells(composition).filter((c) => c.slot === 'stage')).toHaveLength(1);
  });

  it('breaks the tie on identity, so every viewer sees the same picture', () => {
    // Same room, three different orderings of the same facts, and whichever guest is
    // local. Join order and locality must not reach the arrangement.
    const orderings = [
      both,
      [both[1]!, both[0]!, both[2]!],
      [both[2]!, both[1]!, both[0]!],
      [
        guest('sari', { sharing: true, isLocal: true }),
        guest('andre', { sharing: true }),
        guest('budi'),
      ],
    ];
    for (const order of orderings) {
      expect(compose(order, 'obs').stage?.key).toBe('andre.screen');
    }
  });

  it('keeps the second share visible, in the filmstrip beside its owner', () => {
    const keys = compose(both, 'app').filmstrip.map((c) => c.key);
    expect(keys).toContain('sari.screen');
    expect(keys.indexOf('sari.screen')).toBe(keys.indexOf('sari') + 1);
  });

  it('never renders the on-stage screen twice', () => {
    const keys = cells(compose(both, 'obs')).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('audio belongs to the app render only', () => {
  it('never lets the composed OBS render attach audio', () => {
    for (const participants of [THREE, [guest('budi', { sharing: true })]]) {
      expect(compose(participants, 'obs').audio).toBe(false);
    }
  });

  it('keeps the app render playing audio exactly as it does today', () => {
    expect(compose(THREE, 'app').audio).toBe(true);
  });
});

describe('renderAcceptsTrackSource', () => {
  it('subscribes the composed OBS render to video only, so no audio can reach OBS', () => {
    expect(renderAcceptsTrackSource('obs', Track.Source.Camera)).toBe(true);
    expect(renderAcceptsTrackSource('obs', Track.Source.ScreenShare)).toBe(true);
    expect(renderAcceptsTrackSource('obs', Track.Source.Microphone)).toBe(false);
    expect(renderAcceptsTrackSource('obs', Track.Source.ScreenShareAudio)).toBe(false);
  });

  it('leaves the app render hearing everything it hears today', () => {
    for (const source of [
      Track.Source.Camera,
      Track.Source.Microphone,
      Track.Source.ScreenShare,
      Track.Source.ScreenShareAudio,
    ]) {
      expect(renderAcceptsTrackSource('app', source)).toBe(true);
    }
  });

  it('rejects a track the server never labelled, in both renders', () => {
    for (const mode of ['obs', 'app'] as RenderMode[]) {
      expect(renderAcceptsTrackSource(mode, Track.Source.Unknown)).toBe(false);
      expect(renderAcceptsTrackSource(mode, '')).toBe(false);
    }
  });
});

describe('presentationLayout', () => {
  const counts = [1, 2, 3, 4, 5];

  it('runs the filmstrip down the right on a broadcast canvas', () => {
    for (const n of counts) {
      expect(presentationLayout(OBS_CANVAS, n).orientation, `${n} faces`).toBe('column');
    }
  });

  it('leaves the shared screen the room it needs to be readable', () => {
    // The whole point of the feature: on a 1920 canvas the screen still renders around
    // 1500px wide, which is where the 720p publish preset stops being a downscale.
    for (const n of counts) {
      const { stage } = presentationLayout(OBS_CANVAS, n);
      expect(stage.width, `${n} faces`).toBeGreaterThanOrEqual(1400);
      expect(stage.width, `${n} faces`).toBeLessThanOrEqual(1600);
    }
  });

  it('never lets the filmstrip overflow the canvas it is given', () => {
    for (const n of counts) {
      const { filmstrip } = presentationLayout(OBS_CANVAS, n);
      const stacked = n * filmstrip.tileWidth * (9 / 16) + STAGE_GAP * (n - 1);
      expect(stacked, `${n} faces`).toBeLessThanOrEqual(OBS_CANVAS.height);
    }
  });

  it('never lets stage plus filmstrip exceed the width it was given', () => {
    for (const n of counts) {
      const { stage, filmstrip } = presentationLayout(OBS_CANVAS, n);
      expect(stage.width + filmstrip.width + STAGE_GAP, `${n} faces`).toBeLessThanOrEqual(
        OBS_CANVAS.width,
      );
    }
  });

  it('caps how wide a filmstrip face gets, so the stage keeps the space', () => {
    expect(presentationLayout(OBS_CANVAS, 2).filmstrip.tileWidth).toBe(FILMSTRIP_MAX_WIDTH);
  });

  it('scales the strip to the window rather than taking a flat 360px of a laptop', () => {
    // A flat cap sized for a 1920 broadcast canvas is 40% of a 900px window, which would
    // make the screen the smaller half of a layout that exists to enlarge it.
    for (const [width, height] of [
      [1440, 760],
      [1100, 640],
      [900, 560],
    ] as const) {
      const layout = presentationLayout({ width, height }, 3);
      expect(layout.filmstrip.tileWidth, `${width}px`).toBeLessThanOrEqual(width * 0.25);
      expect(layout.stage.width, `${width}px`).toBeGreaterThan(width * 0.7);
    }
  });

  it('never shrinks a filmstrip face below the floor, whatever the window', () => {
    expect(presentationLayout({ width: 800, height: 600 }, 3).filmstrip.tileWidth).toBeGreaterThanOrEqual(
      FILMSTRIP_MIN_WIDTH,
    );
  });

  it('shrinks the faces rather than overflowing when a lot of people are in the room', () => {
    const many = presentationLayout(OBS_CANVAS, 9);
    expect(many.filmstrip.tileWidth).toBeLessThan(FILMSTRIP_MAX_WIDTH);
    expect(9 * many.filmstrip.tileWidth * (9 / 16) + STAGE_GAP * 8).toBeLessThanOrEqual(
      OBS_CANVAS.height,
    );
  });

  it('moves the filmstrip under the stage on a narrow window', () => {
    // A guest on a small laptop window: a right-hand column would leave the screen
    // unreadable, which is the one thing this layout exists to prevent.
    const layout = presentationLayout({ width: 620, height: 780 }, 3);
    expect(layout.orientation).toBe('row');
    expect(layout.stage.width).toBe(620);
    expect(layout.stage.height).toBeLessThan(780);
    expect(3 * layout.filmstrip.tileWidth + STAGE_GAP * 2).toBeLessThanOrEqual(620);
  });

  it('gives the stage everything when there is nobody in the filmstrip', () => {
    const layout = presentationLayout(OBS_CANVAS, 0);
    expect(layout.stage.width).toBe(OBS_CANVAS.width);
    expect(layout.stage.height).toBe(OBS_CANVAS.height);
    expect(layout.filmstrip.tileWidth).toBe(0);
  });

  it('stays positive on an absurdly cramped area rather than collapsing', () => {
    const layout = presentationLayout({ width: 240, height: 180 }, 4);
    expect(layout.stage.width).toBeGreaterThan(0);
    expect(layout.stage.height).toBeGreaterThan(0);
    expect(layout.filmstrip.tileWidth).toBeGreaterThan(0);
  });
});

/**
 * Where every cell actually goes.
 *
 * Both renders position their cells absolutely from this one function, so an arrangement
 * that is wrong here is wrong identically in both places rather than wrong differently.
 * It is also what makes a cell moving between slots a change of box on the same element,
 * never a rebuild: re-attaching a track at render time flashes the video.
 */
describe('layoutCells', () => {
  const room = (n: number, sharing = false): CompositionParticipant[] =>
    Array.from({ length: n }, (_, i) => ({
      identity: `guest-${i}`,
      isLocal: i === n - 1,
      sharing: sharing && i === 0,
    }));

  const cases: Array<[string, Composition, { width: number; height: number }]> = [];
  for (const n of [1, 2, 3, 4, 5]) {
    for (const sharing of [false, true]) {
      for (const [label, area] of [
        ['obs canvas', OBS_CANVAS],
        ['laptop window', { width: 1400, height: 700 }],
        ['narrow window', { width: 620, height: 780 }],
      ] as const) {
        cases.push([`${n} guests, ${sharing ? 'sharing' : 'not sharing'}, ${label}`, compose(room(n, sharing), 'obs'), area]);
      }
    }
  }

  it('gives every cell exactly one box', () => {
    for (const [label, composition, area] of cases) {
      const boxes = layoutCells(composition, area);
      expect(boxes.map((b) => b.key), label).toEqual(cells(composition).map((c) => c.key));
    }
  });

  it('never places a cell outside the area it was given', () => {
    for (const [label, composition, area] of cases) {
      for (const box of layoutCells(composition, area)) {
        expect(box.left, `${label} / ${box.key} left`).toBeGreaterThanOrEqual(0);
        expect(box.top, `${label} / ${box.key} top`).toBeGreaterThanOrEqual(0);
        expect(box.left + box.width, `${label} / ${box.key} right`).toBeLessThanOrEqual(area.width);
        expect(box.top + box.height, `${label} / ${box.key} bottom`).toBeLessThanOrEqual(area.height);
      }
    }
  });

  it('never overlaps two cells', () => {
    for (const [label, composition, area] of cases) {
      const boxes = layoutCells(composition, area);
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const apart =
            a.left + a.width <= b.left ||
            b.left + b.width <= a.left ||
            a.top + a.height <= b.top ||
            b.top + b.height <= a.top;
          expect(apart, `${label}: ${a.key} overlaps ${b.key}`).toBe(true);
        }
      }
    }
  });

  it('gives every cell a positive box, however cramped the area', () => {
    for (const [label, composition, area] of [
      ...cases,
      ['tiny', compose(room(5, true), 'app'), { width: 300, height: 200 }] as const,
    ]) {
      for (const box of layoutCells(composition, area)) {
        expect(box.width, `${label} / ${box.key}`).toBeGreaterThan(0);
        expect(box.height, `${label} / ${box.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('makes the stage far and away the biggest thing on screen', () => {
    for (const [label, composition, area] of cases) {
      if (!composition.stage) continue;
      const boxes = layoutCells(composition, area);
      const stage = boxes.find((b) => b.slot === 'stage')!;
      for (const box of boxes.filter((b) => b.slot !== 'stage')) {
        expect(stage.width * stage.height, `${label}: ${box.key}`).toBeGreaterThan(
          box.width * box.height * 3,
        );
      }
    }
  });

  it('keeps every filmstrip and grid cell at 16:9, so no face is squashed', () => {
    for (const [label, composition, area] of cases) {
      for (const box of layoutCells(composition, area).filter((b) => b.slot !== 'stage')) {
        expect(box.width / box.height, `${label} / ${box.key}`).toBeCloseTo(16 / 9, 1);
      }
    }
  });

  it('centres the arrangement rather than pinning it to a corner', () => {
    // The composed canvas is transparent and the captain composites a background under
    // it, so an arrangement hugging the top left would look like a mistake on air.
    const boxes = layoutCells(compose(room(2), 'obs'), OBS_CANVAS);
    const left = Math.min(...boxes.map((b) => b.left));
    const right = OBS_CANVAS.width - Math.max(...boxes.map((b) => b.left + b.width));
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('respects the cap it is given for the even grid', () => {
    const wide = layoutCells(compose(room(2), 'obs'), OBS_CANVAS, {
      maxTileWidth: OBS_GRID_MAX_TILE_WIDTH,
    });
    expect(wide[0]!.width).toBe(OBS_GRID_MAX_TILE_WIDTH);
  });

  it('puts the stage left of the filmstrip on a wide canvas, and above it on a narrow one', () => {
    const sharing = compose(room(3, true), 'obs');
    const wide = layoutCells(sharing, OBS_CANVAS);
    const stageWide = wide.find((b) => b.slot === 'stage')!;
    expect(wide.filter((b) => b.slot === 'filmstrip').every((b) => b.left > stageWide.left)).toBe(true);

    const narrow = layoutCells(sharing, { width: 620, height: 780 });
    const stageNarrow = narrow.find((b) => b.slot === 'stage')!;
    expect(narrow.filter((b) => b.slot === 'filmstrip').every((b) => b.top > stageNarrow.top)).toBe(
      true,
    );
  });
});

describe('the even grid on a broadcast canvas', () => {
  /**
   * The composed source lays its even grid out with the same maths the room grid uses,
   * but with a different cap. 560px is a "do not fill a laptop with one face" rule; on
   * a 1920x1080 canvas the useful cap is the width at which the 360p simulcast layer
   * stops being enough, which is what the composed source subscribes faces at.
   */
  it('sizes every plausible room to a tile the 360p layer actually covers', () => {
    for (let n = 1; n <= 5; n += 1) {
      const size = tileWidth(n, OBS_CANVAS.width, OBS_CANVAS.height, OBS_GRID_MAX_TILE_WIDTH);
      expect(size, `${n} faces`).toBeLessThanOrEqual(OBS_GRID_MAX_TILE_WIDTH);
      expect(size, `${n} faces`).toBeGreaterThanOrEqual(600);
    }
  });

  it('still fits the canvas in both axes', () => {
    for (let n = 1; n <= 8; n += 1) {
      const size = tileWidth(n, OBS_CANVAS.width, OBS_CANVAS.height, OBS_GRID_MAX_TILE_WIDTH);
      const cols = gridColumns(n);
      const rows = gridRows(n);
      expect(cols * size + GRID_GAP * (cols - 1), `${n} wide`).toBeLessThanOrEqual(OBS_CANVAS.width);
      expect(rows * size * (9 / 16) + GRID_GAP * (rows - 1), `${n} tall`).toBeLessThanOrEqual(
        OBS_CANVAS.height,
      );
    }
  });
});
