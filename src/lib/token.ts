/**
 * Token minting.
 *
 * Runs only in Node, only from scripts/mint.ts and the unit tests. The API secret
 * never reaches the browser and never reaches the built site: tokens are minted
 * ahead of time on the captain's laptop and pasted into links.
 *
 * Two kinds of token exist, and the difference matters:
 *
 * - A guest token can publish and subscribe. It lives in the guest's permanent join
 *   link, which they will keep in a chat thread for years.
 * - An OBS token can only subscribe. If that link ever leaks, the worst outcome is
 *   somebody watching, not somebody appearing on the show.
 */
import { AccessToken } from 'livekit-server-sdk';
import { ROOM_NAME, STAGE_IDENTITY, guestIdentity, obsIdentity, slugifyGuestName } from './identity.ts';
import type { ViewSource } from './view-source.ts';

/** Five years. These links go in a chat thread and must outlive the current season. */
export const DEFAULT_TTL_SECONDS = 5 * 365 * 24 * 60 * 60;

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export interface MintOptions {
  /** Seconds until the token expires. Defaults to {@link DEFAULT_TTL_SECONDS}. */
  ttlSeconds?: number;
}

export interface MintObsOptions extends MintOptions {
  /**
   * Which of the guest's two OBS sources this token is for. Defaults to the camera,
   * whose identity is frozen into every source the captain has already saved.
   */
  source?: ViewSource;
}

/**
 * Read LiveKit credentials from the environment.
 *
 * Throws rather than falling back to the well-known dev keys, because a token
 * silently minted with `devkey` would fail to connect in production in a way that
 * looks like a network problem.
 */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Credentials {
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error(
      'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set. Copy .env.example to .env and fill them in.',
    );
  }
  return { apiKey, apiSecret };
}

/** Mint a publishing token for a guest. Identity is the frozen slug of their name. */
export async function mintGuestToken(
  creds: Credentials,
  guestName: string,
  options: MintOptions = {},
): Promise<string> {
  const slug = guestIdentity(guestName);
  const at = new AccessToken(creds.apiKey, creds.apiSecret, {
    identity: slug,
    name: guestName,
    ttl: options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
  });
  at.addGrant({
    roomJoin: true,
    room: ROOM_NAME,
    canPublish: true,
    canSubscribe: true,
    // Guests have nothing to say to each other over the data channel; the show is
    // the conversation. Leaving this off keeps the surface small.
    canPublishData: false,
    // Lets the guest change the display name shown on the grid tiles. Purely
    // cosmetic - the identity that OBS depends on is fixed in the token and cannot
    // be changed by the client.
    canUpdateOwnMetadata: true,
  });
  return at.toJwt();
}

/**
 * Mint a subscribe-only token for one OBS browser source.
 *
 * The identity is `obs-<slug>` rather than a single shared viewer identity: LiveKit
 * evicts the older session when a duplicate identity connects, so one shared token
 * across four browser sources would leave only the last one connected. A guest's
 * screen source is a second browser source and so needs a second token, differing
 * only in identity; the grant is byte-for-byte the same subscribe-only, hidden one.
 */
export async function mintObsToken(
  creds: Credentials,
  guestName: string,
  options: MintObsOptions = {},
): Promise<string> {
  const slug = slugifyGuestName(guestName);
  const source = options.source ?? 'camera';
  return subscribeOnlyToken(creds, {
    identity: obsIdentity(slug, source),
    name: source === 'screen' ? `OBS ${slug} layar` : `OBS ${slug}`,
    ttlSeconds: options.ttlSeconds,
  });
}

/**
 * Mint the one subscribe-only token for the composed stage browser source.
 *
 * One per show rather than one per guest: the stage renders whoever is in the room, so
 * there is nobody to parameterise it by. The grant is identical to a per-guest OBS
 * token - subscribe only, hidden, recorder - and only the identity differs, which is
 * what stops it evicting a guest's own two sources. See {@link STAGE_IDENTITY}.
 */
export async function mintStageToken(
  creds: Credentials,
  options: MintOptions = {},
): Promise<string> {
  return subscribeOnlyToken(creds, {
    identity: STAGE_IDENTITY,
    name: 'OBS panggung',
    ttlSeconds: options.ttlSeconds,
  });
}

/**
 * The one grant every OBS connection gets, wherever it points.
 *
 * Shared so the three OBS tokens cannot drift apart: if a leaked link can only ever
 * watch, that has to be true of all of them, not of whichever was written first.
 */
async function subscribeOnlyToken(
  creds: Credentials,
  { identity, name, ttlSeconds }: { identity: string; name: string; ttlSeconds?: number },
): Promise<string> {
  const at = new AccessToken(creds.apiKey, creds.apiSecret, {
    identity,
    name,
    ttl: ttlSeconds ?? DEFAULT_TTL_SECONDS,
  });
  at.addGrant({
    roomJoin: true,
    room: ROOM_NAME,
    canPublish: false,
    canPublishData: false,
    canSubscribe: true,
    // Keeps the OBS source out of the guests' grid, so nobody sees a ghost tile.
    hidden: true,
    // Marks the connection as a recorder in LiveKit's own metadata. Harmless here,
    // and it makes the participant list readable when debugging.
    recorder: true,
  });
  return at.toJwt();
}
