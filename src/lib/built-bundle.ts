/**
 * Does the already-built site agree with the LiveKit address configured right now?
 *
 * `PUBLIC_LIVEKIT_URL` is inlined into the bundle at build time, so editing `.env`
 * changes nothing that is already built. The build gate in `astro.config.mjs` catches
 * the address being absent; this catches the subtler case where it is present but the
 * bundle was built against a different one. That build succeeds, looks correct, and
 * fails only when a guest cannot connect - which is why minting, the last step before
 * links reach real guests, refuses on it.
 *
 * Everything here is pure. Reading the built assets off disk lives in scripts/mint.ts.
 */

/**
 * Every distinct `ws://` or `wss://` address that appears as a string literal in one
 * built asset, in order of first appearance.
 *
 * The bundle is minified and its filename is content-hashed, so the address can only be
 * found by searching for its shape. Quoting is required: minifiers emit the value as a
 * backtick, single-, or double-quoted literal, and requiring a quote keeps a URL that
 * merely appears inside a comment or a longer string out of the result. All matches are
 * returned rather than the first, because the caller only needs to know whether the
 * configured address is among them - a bundle that later carries a second websocket
 * address for some other reason must not make this guess wrongly.
 */
export function extractLivekitUrls(source: string): string[] {
  const pattern = /(["'`])(wss?:\/\/[^"'`\s]+)\1/g;
  const found = new Set<string>();
  for (const match of source.matchAll(pattern)) found.add(match[2]!);
  return [...found];
}

export interface BuiltUrlCheck {
  /** The currently configured `PUBLIC_LIVEKIT_URL`, if there is one. */
  configured: string | undefined;
  /** Addresses found in the built assets, from {@link extractLivekitUrls}. */
  built: string[];
}

export interface Verdict {
  ok: boolean;
  /** Why it refused. Empty when `ok`. */
  message: string;
}

/**
 * Compare the configured address against what the build actually carries.
 *
 * With no address configured there is nothing to disagree with: minting does not read
 * `PUBLIC_LIVEKIT_URL` itself, and the missing case is already the build gate's job.
 */
export function checkBuiltLivekitUrl({ configured, built }: BuiltUrlCheck): Verdict {
  const wanted = normalise(configured ?? '');
  if (!wanted) return { ok: true, message: '' };

  if (built.some((candidate) => normalise(candidate) === wanted)) return { ok: true, message: '' };

  // A built site with no recognisable address refuses rather than passes. Such a bundle
  // could not connect to any server, so minting against it would hand out links to a
  // site that is already dead; and if instead the extraction has gone stale against a
  // future bundler output, refusing is the loud failure and a rebuild - which the build
  // gate forces to carry an address - is the fix either way.
  if (built.length === 0) {
    return {
      ok: false,
      message: [
        'Refusing to mint: no LiveKit address could be found in the built site under dist/.',
        `Configured PUBLIC_LIVEKIT_URL: ${configured}`,
        'The built site would ignore the server these links are for.',
        'Run `npm run build` again, then mint.',
      ].join('\n'),
    };
  }

  return {
    ok: false,
    message: [
      'Refusing to mint: the built site in dist/ was built against a different LiveKit server.',
      `Configured PUBLIC_LIVEKIT_URL: ${configured}`,
      `Built into dist/:              ${built.join(', ')}`,
      'PUBLIC_LIVEKIT_URL is baked in at build time, so the built site would ignore the',
      'server these links are for and guests would fail to connect.',
      'Run `npm run build` again, then mint.',
    ].join('\n'),
  };
}

/**
 * Trailing slashes and casing are cosmetic to LiveKit, so they must not be grounds for
 * refusing. Nothing else is normalised: a differing port or path is a real difference.
 */
function normalise(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}
