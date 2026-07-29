import { describe, expect, it } from 'vitest';
import { GRID_GAP, MAX_TILE_WIDTH, gridColumns, gridRows, orderTiles, tileWidth } from '../src/lib/layout.ts';

/** Laptop viewport minus the room header and the control bar. */
const AREA = { width: 1400, height: 700 };

/** What the grid actually occupies once a tile width is chosen. */
function occupied(count: number, width: number) {
  const cols = gridColumns(count);
  const rows = gridRows(count);
  return {
    width: cols * width + GRID_GAP * (cols - 1),
    height: rows * (width * (9 / 16)) + GRID_GAP * (rows - 1),
  };
}

describe('gridColumns', () => {
  it('never returns zero columns, even with an empty room', () => {
    expect(gridColumns(0)).toBeGreaterThan(0);
  });

  it('uses one column for a solo guest so the tile is not tiny', () => {
    expect(gridColumns(1)).toBe(1);
  });

  it('covers the real show sizes of three to five people', () => {
    expect(gridColumns(2)).toBe(2);
    // One row of three rather than a 2x2 with a hole in it.
    expect(gridColumns(3)).toBe(3);
    expect(gridColumns(4)).toBe(2);
    expect(gridColumns(5)).toBe(3);
    expect(gridColumns(6)).toBe(3);
  });

  // Beyond eight the four-column cap forces gaps, but the show is 3-5 guests and
  // has never been near that, so the tidiness guarantee is scoped to what can happen.
  it('never leaves more than one cell empty at plausible room sizes', () => {
    for (let n = 1; n <= 8; n += 1) {
      const empty = gridColumns(n) * gridRows(n) - n;
      expect(empty, `${n} tiles`).toBeLessThanOrEqual(1);
    }
  });

  it('never puts more than four tiles in a row on a laptop screen', () => {
    for (let n = 1; n <= 20; n += 1) {
      expect(gridColumns(n)).toBeLessThanOrEqual(4);
    }
  });

  it('always leaves enough cells for every tile', () => {
    for (let n = 1; n <= 20; n += 1) {
      expect(gridColumns(n) * gridRows(n)).toBeGreaterThanOrEqual(n);
    }
  });
});

describe('tileWidth', () => {
  it('never overflows the area horizontally, at any room size', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(occupied(n, tileWidth(n, AREA.width, AREA.height)).width, `${n} tiles`).toBeLessThanOrEqual(
        AREA.width,
      );
    }
  });

  it('never overflows vertically either, which is what forces scrolling in a call', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(occupied(n, tileWidth(n, AREA.width, AREA.height)).height, `${n} tiles`).toBeLessThanOrEqual(
        AREA.height,
      );
    }
  });

  it('fills a laptop screen for a two-person room instead of leaving it mostly empty', () => {
    // The old fixed 420px cap wasted roughly half the width at this size.
    expect(tileWidth(2, AREA.width, AREA.height)).toBeGreaterThan(500);
  });

  it('caps tile size so a solo guest does not get one absurd wall-sized tile', () => {
    expect(tileWidth(1, 3840, 2160)).toBe(MAX_TILE_WIDTH);
  });

  it('never exceeds the cap, whatever the room size', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(tileWidth(n, AREA.width, AREA.height), `${n} tiles`).toBeLessThanOrEqual(MAX_TILE_WIDTH);
    }
  });

  // Tile size is not monotonic in guest count, and that is deliberate: three guests
  // get one tidy row of three (458px each) where a 2x2 with a hole would have given
  // them 560px. Tidiness wins for the conversation grid, and 458px is ample for it.
  it('accepts slightly smaller tiles for three guests to keep the row tidy', () => {
    expect(tileWidth(3, AREA.width, AREA.height)).toBeLessThan(tileWidth(4, AREA.width, AREA.height));
    expect(gridRows(3)).toBe(1);
  });

  it('stays positive on a cramped window rather than collapsing to zero', () => {
    expect(tileWidth(5, 320, 200)).toBeGreaterThan(0);
  });

  it('is bounded by height when the window is wide and short', () => {
    // A 2000x300 area cannot use its width; height must be the binding constraint.
    expect(tileWidth(2, 2000, 300)).toBeLessThan(tileWidth(2, 2000, 1200));
  });
});

describe('orderTiles', () => {
  const tile = (identity: string, isLocal = false) => ({ identity, isLocal });

  it('puts the local guest last so their own tile does not jump around', () => {
    const ordered = orderTiles([tile('me', true), tile('sari'), tile('andre')]);
    expect(ordered.at(-1)?.identity).toBe('me');
  });

  it('orders remote guests deterministically, so tiles do not reshuffle on rerender', () => {
    const a = orderTiles([tile('sari'), tile('andre'), tile('me', true)]);
    const b = orderTiles([tile('andre'), tile('me', true), tile('sari')]);
    expect(a.map((t) => t.identity)).toEqual(b.map((t) => t.identity));
    expect(a.map((t) => t.identity)).toEqual(['andre', 'sari', 'me']);
  });

  it('handles a room where the guest is alone', () => {
    expect(orderTiles([tile('me', true)]).map((t) => t.identity)).toEqual(['me']);
  });
});
