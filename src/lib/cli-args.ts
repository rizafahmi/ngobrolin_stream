/**
 * Argument parsing for scripts/mint.ts.
 *
 * Split out from the script itself so the branches can be tested without shelling
 * out. The parser is strict on purpose: a typo that silently mints a token with the
 * wrong base URL produces links that fail only on show day.
 */
import { DEFAULT_TTL_SECONDS } from './token.ts';

/** Where links point when nothing else says otherwise. */
export const DEFAULT_BASE_URL = 'http://localhost:4321';

export interface MintArgs {
  names: string[];
  baseUrl: string;
  ttlSeconds: number;
  help: boolean;
}

export function parseMintArgs(argv: string[], env: NodeJS.ProcessEnv): MintArgs {
  const names: string[] = [];
  let baseUrl = env.PUBLIC_SITE_URL?.trim() || DEFAULT_BASE_URL;
  let ttlSeconds = DEFAULT_TTL_SECONDS;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg === '--help' || arg === '-h') {
      return { names, baseUrl, ttlSeconds, help: true };
    }

    if (arg === '--base') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--base needs a URL, for example --base https://ngobrolin.example.com');
      }
      baseUrl = value;
      i += 1;
      continue;
    }

    if (arg === '--ttl-days') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--ttl-days needs a positive number of days');
      }
      ttlSeconds = Math.round(value * 24 * 60 * 60);
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown flag ${arg}. Run with --help.`);
    }

    names.push(arg);
  }

  if (names.length === 0) {
    throw new Error('Pass at least one guest name, for example: npm run mint -- "Budi"');
  }

  return { names, baseUrl, ttlSeconds, help: false };
}
