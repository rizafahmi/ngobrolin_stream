/**
 * Reading a token in the browser.
 *
 * Deliberately separate from token.ts: that module imports livekit-server-sdk, which
 * drags node:crypto in with it. Keeping the browser's half here means the join page
 * bundle cannot accidentally pull the minting code along, rather than relying on the
 * bundler to tree-shake it out.
 *
 * This decodes without verifying, which is fine because nothing here is trusted: the
 * name is a form default, and the server checks the signature at connect time.
 */

/** Decode a JWT payload without verifying it. Returns null for anything malformed. */
export function decodeTokenPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
