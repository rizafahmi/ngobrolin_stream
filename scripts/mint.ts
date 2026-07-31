#!/usr/bin/env node
/**
 * Mint a guest's permanent join link and their two OBS browser source URLs.
 *
 *   npm run mint -- "Budi Santoso"
 *   npm run mint -- "Budi Santoso" --base https://ngobrolin.example.com
 *   npm run mint -- "Budi" "Sari" "Andre"
 *
 * Run once per guest, ever. Re-running for the same name produces a new token but
 * the same identity, so an OBS scene built on the old view URL keeps working - only
 * the `t=` half of the URL needs replacing.
 *
 * Argument parsing lives in src/lib/cli-args.ts so it can be tested directly.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBuiltLivekitUrl, extractLivekitUrls } from '../src/lib/built-bundle.ts';
import { parseMintArgs } from '../src/lib/cli-args.ts';
import { slugifyGuestName } from '../src/lib/identity.ts';
import { credentialsFromEnv, mintGuestToken, mintObsToken, mintStageToken } from '../src/lib/token.ts';
import { joinUrl, stageUrl, viewUrl } from '../src/lib/urls.ts';

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: npm run mint -- <guest name> [more names...] [--base <site url>] [--ttl-days <n>]',
      '',
      '  --base       Site the links point at. Defaults to $PUBLIC_SITE_URL, then http://localhost:4321.',
      '  --ttl-days   Token lifetime in days. Defaults to 1825 (five years).',
      '',
      'Requires LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the environment or in .env.',
      '',
    ].join('\n'),
  );
}

/** Absolute path of `dist/`, resolved from this script rather than the shell's cwd. */
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

/**
 * Every `ws://`/`wss://` address inlined into the built JavaScript under `dist/`.
 *
 * The walk is deliberately shallow in intent but recursive in fact: asset filenames are
 * content-hashed and their directory is an Astro implementation detail, so nothing here
 * may assume a fixed path. Returns null when there is no `dist/` at all - nothing has
 * been built, so there is nothing to disagree with.
 */
function builtLivekitUrls(dir: string): string[] | null {
  if (!existsSync(dir)) return null;
  const urls = new Set<string>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    for (const url of extractLivekitUrls(readFileSync(join(entry.parentPath, entry.name), 'utf8'))) {
      urls.add(url);
    }
  }
  return [...urls];
}

async function main(): Promise<void> {
  const args = parseMintArgs(process.argv.slice(2), process.env);
  if (args.help) {
    printUsage();
    return;
  }

  // Guard before any token is minted: links minted against a stale build point guests at
  // a server the deployed site will never talk to, and that only shows up on show day.
  const built = builtLivekitUrls(distDir);
  if (built !== null) {
    const verdict = checkBuiltLivekitUrl({ configured: process.env.PUBLIC_LIVEKIT_URL, built });
    if (!verdict.ok) throw new Error(verdict.message);
  }

  const creds = credentialsFromEnv();
  const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000);

  for (const name of args.names) {
    const slug = slugifyGuestName(name);
    const guestToken = await mintGuestToken(creds, name, { ttlSeconds: args.ttlSeconds });
    const obsToken = await mintObsToken(creds, name, { ttlSeconds: args.ttlSeconds });
    // A second browser source needs a second token: LiveKit evicts the older session
    // when a duplicate identity connects, so sharing the camera token between the two
    // sources would leave only whichever OBS loaded last alive.
    const obsScreenToken = await mintObsToken(creds, name, {
      ttlSeconds: args.ttlSeconds,
      source: 'screen',
    });

    process.stdout.write(
      [
        '',
        `=== ${name}  (id: ${slug})`,
        '',
        'Link untuk tamu (kirim ini ke mereka):',
        `  ${joinUrl(args.baseUrl, guestToken)}`,
        '',
        'OBS browser source URL:',
        `  ${viewUrl(args.baseUrl, slug, obsToken)}`,
        '',
        'OBS browser source URL (layar):',
        `  ${viewUrl(args.baseUrl, slug, obsScreenToken, 'screen')}`,
        '',
        `Berlaku sampai: ${expiresAt.toISOString().slice(0, 10)}`,
        '',
      ].join('\n'),
    );
  }

  // Once for the show, after every guest, never inside the per-guest block. The stage
  // renders whoever is in the room, so there is nothing to parameterise it by - and
  // printing it per guest would invite the captain to add three of them, which is three
  // identical participants on the meter and only one of them ever visible.
  const stageToken = await mintStageToken(creds, { ttlSeconds: args.ttlSeconds });
  process.stdout.write(
    [
      '',
      '=== Panggung  (satu untuk seluruh acara)',
      '',
      'OBS browser source URL (panggung):',
      `  ${stageUrl(args.baseUrl, stageToken)}`,
      '',
      `Berlaku sampai: ${expiresAt.toISOString().slice(0, 10)}`,
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
