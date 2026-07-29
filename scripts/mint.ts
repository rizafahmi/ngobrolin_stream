#!/usr/bin/env node
/**
 * Mint a guest's permanent join link and the matching OBS browser source URL.
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
import { parseMintArgs } from '../src/lib/cli-args.ts';
import { slugifyGuestName } from '../src/lib/identity.ts';
import { credentialsFromEnv, mintGuestToken, mintObsToken } from '../src/lib/token.ts';
import { joinUrl, viewUrl } from '../src/lib/urls.ts';

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

async function main(): Promise<void> {
  const args = parseMintArgs(process.argv.slice(2), process.env);
  if (args.help) {
    printUsage();
    return;
  }

  const creds = credentialsFromEnv();
  const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000);

  for (const name of args.names) {
    const slug = slugifyGuestName(name);
    const guestToken = await mintGuestToken(creds, name, { ttlSeconds: args.ttlSeconds });
    const obsToken = await mintObsToken(creds, name, { ttlSeconds: args.ttlSeconds });

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
        `Berlaku sampai: ${expiresAt.toISOString().slice(0, 10)}`,
        '',
      ].join('\n'),
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
