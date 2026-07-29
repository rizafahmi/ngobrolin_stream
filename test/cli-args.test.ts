import { describe, expect, it } from 'vitest';
import { DEFAULT_TTL_SECONDS } from '../src/lib/token.ts';
import { parseMintArgs } from '../src/lib/cli-args.ts';

describe('parseMintArgs', () => {
  it('collects bare arguments as guest names', () => {
    expect(parseMintArgs(['Budi', 'Sari'], {}).names).toEqual(['Budi', 'Sari']);
  });

  it('keeps a multi-word name passed as one quoted argument intact', () => {
    expect(parseMintArgs(['Budi Santoso'], {}).names).toEqual(['Budi Santoso']);
  });

  it('defaults the base URL to the dev server when nothing says otherwise', () => {
    expect(parseMintArgs(['Budi'], {}).baseUrl).toBe('http://localhost:4321');
  });

  it('prefers PUBLIC_SITE_URL over the dev default', () => {
    expect(parseMintArgs(['Budi'], { PUBLIC_SITE_URL: 'https://x.test' }).baseUrl).toBe('https://x.test');
  });

  it('lets --base override the environment', () => {
    const args = parseMintArgs(['Budi', '--base', 'https://y.test'], { PUBLIC_SITE_URL: 'https://x.test' });
    expect(args.baseUrl).toBe('https://y.test');
    expect(args.names).toEqual(['Budi']);
  });

  it('defaults to the five-year token lifetime', () => {
    expect(parseMintArgs(['Budi'], {}).ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
  });

  it('converts --ttl-days to seconds', () => {
    expect(parseMintArgs(['Budi', '--ttl-days', '30'], {}).ttlSeconds).toBe(30 * 24 * 60 * 60);
  });

  it('refuses a --base with no value, rather than swallowing the next name', () => {
    expect(() => parseMintArgs(['Budi', '--base'], {})).toThrow(/--base/);
  });

  it('rejects a nonsense ttl instead of minting a token that expires immediately', () => {
    expect(() => parseMintArgs(['Budi', '--ttl-days', 'soon'], {})).toThrow(/--ttl-days/);
    expect(() => parseMintArgs(['Budi', '--ttl-days', '0'], {})).toThrow(/--ttl-days/);
    expect(() => parseMintArgs(['Budi', '--ttl-days', '-5'], {})).toThrow(/--ttl-days/);
  });

  it('rejects unknown flags rather than treating them as a guest name', () => {
    expect(() => parseMintArgs(['--oops'], {})).toThrow(/--oops/);
  });

  it('requires at least one name', () => {
    expect(() => parseMintArgs([], {})).toThrow(/guest name/);
    expect(() => parseMintArgs(['--base', 'https://x.test'], {})).toThrow(/guest name/);
  });

  it('reports a help request instead of trying to mint', () => {
    expect(parseMintArgs(['--help'], {}).help).toBe(true);
    expect(parseMintArgs(['-h'], {}).help).toBe(true);
  });
});
