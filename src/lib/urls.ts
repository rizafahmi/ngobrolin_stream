/**
 * Link shapes.
 *
 * Both links are permanent. The join link is what a guest bookmarks; the view URL is
 * what goes into an OBS browser source and must survive being saved in a scene
 * collection for a year.
 */

/** `<base>/?t=<token>` - the guest's permanent join link. */
export function joinUrl(baseUrl: string, token: string): string {
  const url = new URL('/', ensureTrailingSlash(baseUrl));
  url.searchParams.set('t', token);
  return url.toString();
}

/**
 * `<base>/view?id=<slug>&t=<token>` - the OBS browser source URL.
 *
 * `id` names the participant to render and is the human-readable half; `t` is the
 * subscribe-only token that lets OBS into the room at all.
 */
export function viewUrl(baseUrl: string, guestSlug: string, token: string): string {
  const url = new URL('view', ensureTrailingSlash(baseUrl));
  url.searchParams.set('id', guestSlug);
  url.searchParams.set('t', token);
  return url.toString();
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}
