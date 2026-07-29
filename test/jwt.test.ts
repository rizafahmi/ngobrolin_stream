import { describe, expect, it } from 'vitest';
import { decodeTokenPayload } from '../src/lib/jwt.ts';
import { mintGuestToken } from '../src/lib/token.ts';

const CREDS = { apiKey: 'devkey', apiSecret: 'secret-that-is-long-enough-for-hs256' };

describe('decodeTokenPayload', () => {
  it('reads back the claims the browser needs to prefill the name field', async () => {
    const jwt = await mintGuestToken(CREDS, 'Budi Santoso');
    expect(decodeTokenPayload(jwt)).toMatchObject({ sub: 'budi-santoso', name: 'Budi Santoso' });
  });

  it('handles base64url payloads containing - and _ without throwing', async () => {
    // A name whose UTF-8 bytes force the base64url-only characters into the payload.
    const jwt = await mintGuestToken(CREDS, 'Andre þÿ Wibowo');
    expect(decodeTokenPayload(jwt)).not.toBeNull();
  });

  it('returns null rather than throwing on a link somebody mangled', () => {
    expect(decodeTokenPayload('not-a-jwt')).toBeNull();
    expect(decodeTokenPayload('a.b.c')).toBeNull();
    expect(decodeTokenPayload('')).toBeNull();
  });
});
