import { describe, expect, it } from 'vitest';
import { checkBuiltLivekitUrl, extractLivekitUrls } from '../src/lib/built-bundle.ts';

describe('extractLivekitUrls', () => {
  it('finds an address inlined as a minified string literal', () => {
    const source = 'const T=`wss://example-abc.livekit.cloud`;function a(){}';
    expect(extractLivekitUrls(source)).toEqual(['wss://example-abc.livekit.cloud']);
  });

  it('finds addresses in single and double quotes too', () => {
    expect(extractLivekitUrls(`var a="ws://localhost:7880",b='wss://x.example.test'`)).toEqual([
      'ws://localhost:7880',
      'wss://x.example.test',
    ]);
  });

  it('reports each distinct address once, however often it appears', () => {
    const source = '`ws://localhost:7880`+`ws://localhost:7880`';
    expect(extractLivekitUrls(source)).toEqual(['ws://localhost:7880']);
  });

  it('ignores http addresses and unquoted lookalikes', () => {
    expect(extractLivekitUrls('"https://ngobrolin.example.com" ws://bare.example.test')).toEqual([]);
  });

  it('returns nothing for output that carries no address at all', () => {
    expect(extractLivekitUrls('console.log(1)')).toEqual([]);
  });
});

describe('checkBuiltLivekitUrl', () => {
  it('accepts a build whose address matches the configured one', () => {
    const verdict = checkBuiltLivekitUrl({
      configured: 'wss://example-abc.livekit.cloud',
      built: ['wss://example-abc.livekit.cloud'],
    });
    expect(verdict.ok).toBe(true);
  });

  it('ignores a trailing slash and case differences in the address', () => {
    const verdict = checkBuiltLivekitUrl({
      configured: 'WSS://Example-ABC.LiveKit.Cloud/',
      built: ['wss://example-abc.livekit.cloud'],
    });
    expect(verdict.ok).toBe(true);
  });

  it('accepts when the configured address is one of several in the bundle', () => {
    const verdict = checkBuiltLivekitUrl({
      configured: 'wss://example-abc.livekit.cloud',
      built: ['ws://localhost:7880', 'wss://example-abc.livekit.cloud'],
    });
    expect(verdict.ok).toBe(true);
  });

  it('refuses a stale build and names both addresses and the fix', () => {
    const verdict = checkBuiltLivekitUrl({
      configured: 'wss://example-abc.livekit.cloud',
      built: ['ws://localhost:7880'],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('wss://example-abc.livekit.cloud');
    expect(verdict.message).toContain('ws://localhost:7880');
    expect(verdict.message).toContain('npm run build');
  });

  it('refuses a build with no recognisable address', () => {
    const verdict = checkBuiltLivekitUrl({
      configured: 'wss://example-abc.livekit.cloud',
      built: [],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('npm run build');
  });

  it('has nothing to say when no address is configured', () => {
    const verdict = checkBuiltLivekitUrl({ configured: undefined, built: ['ws://localhost:7880'] });
    expect(verdict.ok).toBe(true);
  });
});
