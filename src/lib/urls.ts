/**
 * Link shapes.
 *
 * Both links are permanent. The join link is what a guest bookmarks; the view URL is
 * what goes into an OBS browser source and must survive being saved in a scene
 * collection for a year.
 */

import { SCREEN_VIEW_SOURCE, VIEW_SOURCE_PARAM, type ViewSource } from './view-source.ts';

/** `<base>/?t=<token>` - the guest's permanent join link. */
export function joinUrl(baseUrl: string, token: string): string {
  const url = new URL('/', ensureTrailingSlash(baseUrl));
  url.searchParams.set('t', token);
  return url.toString();
}

/**
 * `<base>/view?id=<slug>&t=<token>` - the OBS browser source URL for a guest's camera,
 * and `<base>/view?id=<slug>&source=screen&t=<token>` for their screen share.
 *
 * `id` names the participant to render and is the human-readable half; `t` is the
 * subscribe-only token that lets OBS into the room at all. Both URLs are derived from
 * the same frozen slug, so a scene built once keeps working week after week.
 *
 * The camera URL emits **no** `source` parameter, by design rather than by omission:
 * the captain has OBS scenes saved against the pre-screen-share URLs on a live show,
 * and adding a second kind of source may not move a byte of the first kind. That is
 * also why `source` is appended in the middle rather than at the end - `t` is a long
 * JWT, and a human scanning two URLs side by side can see the difference before it.
 */
export function viewUrl(
  baseUrl: string,
  guestSlug: string,
  token: string,
  source: ViewSource = 'camera',
): string {
  const url = new URL('view', ensureTrailingSlash(baseUrl));
  url.searchParams.set('id', guestSlug);
  if (source === 'screen') url.searchParams.set(VIEW_SOURCE_PARAM, SCREEN_VIEW_SOURCE);
  url.searchParams.set('t', token);
  return url.toString();
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}
