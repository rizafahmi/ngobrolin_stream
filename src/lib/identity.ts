/**
 * Stable per-guest identities.
 *
 * This is the load-bearing piece of the whole system. A saved OBS scene points at
 * `/view?id=<slug>`; that URL only keeps working week after week if the slug derived
 * from a guest's name never changes and the guest always reconnects to LiveKit under
 * that exact identity. Everything else here exists to make that true.
 *
 * Rules:
 * - The slug is derived from the guest's name once, at minting time, and then frozen
 *   into the token. The display name a guest types on the join page is cosmetic and
 *   never affects identity.
 * - The room name is a single fixed constant. One show, one room, forever.
 */

import type { ViewSource } from './view-source.ts';

/** The one and only room. There is no multi-tenancy and there never will be. */
export const ROOM_NAME = 'ngobrolin';

/** Prefix for the read-only identities OBS connects with, one per guest source. */
export const OBS_IDENTITY_PREFIX = 'obs-';

/**
 * Turn a human name into a stable, URL-safe slug.
 *
 * Deliberately lossy and deliberately boring: lowercase ASCII letters, digits and
 * single dashes. Accented characters are folded to their base letter so that "Ándre"
 * and "Andre" cannot drift into two different identities.
 */
export function slugifyGuestName(name: string): string {
  const slug = name
    .normalize('NFD')
    // Strip combining marks left behind by NFD (accents, umlauts, and friends).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    throw new Error(
      `Cannot derive a guest id from ${JSON.stringify(name)}: no ASCII letters or digits in it. ` +
        'Pass a plain name such as "Budi" instead.',
    );
  }
  return slug;
}

/** The LiveKit identity a guest publishes under. Identical to their slug. */
export function guestIdentity(name: string): string {
  return slugifyGuestName(name);
}

/**
 * The LiveKit identity an OBS browser source connects under.
 *
 * Each OBS source needs its own identity: LiveKit disconnects the older session when
 * a second connection arrives with the same identity, so reusing one viewer identity
 * across four browser sources would leave only the last one alive. That applies just
 * as much to a guest's two sources as to two guests, which is why the screen source
 * gets a suffix rather than sharing the camera source's identity.
 *
 * The suffix is joined with a dot because a slug is only `[a-z0-9-]`: a dash-joined
 * `obs-budi-screen` would be ambiguous between Budi's screen source and the camera
 * source of a guest called "Budi Screen". A dot can never appear in a slug, so the
 * two spaces cannot overlap.
 *
 * The camera form is unchanged and must stay that way: it is frozen into every OBS
 * token the captain has already pasted into a scene.
 */
export function obsIdentity(guestSlug: string, source: ViewSource = 'camera'): string {
  const suffix = source === 'screen' ? '.screen' : '';
  return `${OBS_IDENTITY_PREFIX}${guestSlug}${suffix}`;
}

/** True when an identity belongs to an OBS browser source rather than a guest. */
export function isObsIdentity(identity: string): boolean {
  return identity.startsWith(OBS_IDENTITY_PREFIX);
}
