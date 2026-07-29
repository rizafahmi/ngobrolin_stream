/**
 * Grid layout maths for the in-room view.
 *
 * The room grid is for conversation, not for broadcast, so the only goal is that
 * every tile stays a stable 16:9 and nobody's face gets cropped to a sliver when a
 * fifth person joins. Column counts are chosen rather than computed from the
 * viewport so that the layout never reflows while somebody is speaking.
 */

/**
 * Columns to use for a given number of visible tiles on a laptop-width window.
 *
 * A lookup rather than a formula because the counts that matter are 3 to 5 and the
 * obvious formulas get those wrong: ceil(sqrt(n)) would lay three guests out as a
 * 2x2 with a hole in it, when one row of three is both tidier and larger.
 */
const COLUMNS_BY_TILE_COUNT = [1, 1, 2, 3, 2, 3, 3, 4, 4, 3] as const;

export function gridColumns(tileCount: number): number {
  if (tileCount <= 0) return 1;
  return COLUMNS_BY_TILE_COUNT[tileCount] ?? 4;
}

/** Gap between tiles, in px. Must match the `gap` in .grid. */
export const GRID_GAP = 12;

/** Ceiling on tile width, so a one-guest room does not become a wall of face. */
export const MAX_TILE_WIDTH = 560;

/** Tiles are 16:9 to match what guests publish. */
const ASPECT = 16 / 9;

/**
 * Largest tile width that still fits the whole grid inside the available area.
 *
 * Computed rather than left to CSS because the binding constraint switches between
 * width and height depending on the room size: two guests on a laptop are limited by
 * width, five are limited by height. Getting this wrong means the grid scrolls, and
 * a guest who has to scroll during a recording will not notice someone talking.
 */
export function tileWidth(tileCount: number, availableWidth: number, availableHeight: number): number {
  const cols = gridColumns(tileCount);
  const rows = gridRows(tileCount);

  const byWidth = (availableWidth - GRID_GAP * (cols - 1)) / cols;
  const byHeight = ((availableHeight - GRID_GAP * (rows - 1)) / rows) * ASPECT;

  // Floor keeps sub-pixel rounding from pushing the last column over the edge.
  return Math.max(1, Math.floor(Math.min(byWidth, byHeight, MAX_TILE_WIDTH)));
}

/** Rows implied by the column count. Used only to keep tiles from overflowing. */
export function gridRows(tileCount: number): number {
  if (tileCount <= 0) return 1;
  return Math.ceil(tileCount / gridColumns(tileCount));
}

/**
 * Order tiles so that the local guest is always last.
 *
 * A guest watching their own tile jump around as other people join is distracting,
 * and self-view is the least useful tile on the page once the show has started.
 */
export function orderTiles<T extends { identity: string; isLocal: boolean }>(tiles: T[]): T[] {
  const remote = tiles.filter((t) => !t.isLocal).sort((a, b) => a.identity.localeCompare(b.identity));
  const local = tiles.filter((t) => t.isLocal);
  return [...remote, ...local];
}
