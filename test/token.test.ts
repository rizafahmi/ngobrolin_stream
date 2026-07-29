import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TTL_SECONDS,
  credentialsFromEnv,
  mintGuestToken,
  mintObsToken,
} from '../src/lib/token.ts';
import { ROOM_NAME } from '../src/lib/identity.ts';

const CREDS = { apiKey: 'devkey', apiSecret: 'secret-that-is-long-enough-for-hs256' };

interface Claims {
  sub: string;
  name: string;
  exp: number;
  nbf: number;
  video: Record<string, unknown>;
}

function claimsOf(jwt: string): Claims {
  const payload = jwt.split('.')[1]!;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims;
}

describe('mintGuestToken', () => {
  it('freezes the guest slug as the token identity', async () => {
    const jwt = await mintGuestToken(CREDS, 'Budi Santoso');
    expect(claimsOf(jwt).sub).toBe('budi-santoso');
  });

  it('keeps the identity stable no matter how the name is typed', async () => {
    const a = claimsOf(await mintGuestToken(CREDS, 'Budi Santoso'));
    const b = claimsOf(await mintGuestToken(CREDS, '  budi   SANTOSO '));
    expect(a.sub).toBe(b.sub);
  });

  it('carries the original name for display', async () => {
    expect(claimsOf(await mintGuestToken(CREDS, 'Budi Santoso')).name).toBe('Budi Santoso');
  });

  it('grants publish and subscribe in the one room', async () => {
    const grant = claimsOf(await mintGuestToken(CREDS, 'Budi')).video;
    expect(grant).toMatchObject({
      roomJoin: true,
      room: ROOM_NAME,
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('defaults to a link that outlives a season', async () => {
    const { exp, nbf } = claimsOf(await mintGuestToken(CREDS, 'Budi'));
    expect(exp - nbf).toBe(DEFAULT_TTL_SECONDS);
  });

  it('honours an explicit ttl', async () => {
    const { exp, nbf } = claimsOf(await mintGuestToken(CREDS, 'Budi', { ttlSeconds: 3600 }));
    expect(exp - nbf).toBe(3600);
  });
});

describe('mintObsToken', () => {
  it('uses a distinct identity per guest so sources do not evict each other', async () => {
    const a = claimsOf(await mintObsToken(CREDS, 'Budi'));
    const b = claimsOf(await mintObsToken(CREDS, 'Sari'));
    expect(a.sub).toBe('obs-budi');
    expect(b.sub).toBe('obs-sari');
    expect(a.sub).not.toBe(b.sub);
  });

  it('never grants publish, so a leaked OBS link cannot put anyone on air', async () => {
    const grant = claimsOf(await mintObsToken(CREDS, 'Budi')).video;
    expect(grant).toMatchObject({
      canPublish: false,
      canPublishData: false,
      canSubscribe: true,
    });
  });

  it('is hidden, so guests never see a ghost tile for the OBS connection', async () => {
    expect(claimsOf(await mintObsToken(CREDS, 'Budi')).video).toMatchObject({ hidden: true });
  });

  it('does not collide with the guest identity for the same person', async () => {
    const guest = claimsOf(await mintGuestToken(CREDS, 'Budi'));
    const obs = claimsOf(await mintObsToken(CREDS, 'Budi'));
    expect(guest.sub).not.toBe(obs.sub);
  });
});

describe('credentialsFromEnv', () => {
  it('reads both values from the environment', () => {
    expect(credentialsFromEnv({ LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' })).toEqual({
      apiKey: 'k',
      apiSecret: 's',
    });
  });

  it('refuses to guess when either value is missing', () => {
    expect(() => credentialsFromEnv({ LIVEKIT_API_KEY: 'k' })).toThrow(/LIVEKIT_API_SECRET/);
    expect(() => credentialsFromEnv({})).toThrow(/LIVEKIT_API_KEY/);
  });

  it('treats whitespace-only values as missing', () => {
    expect(() => credentialsFromEnv({ LIVEKIT_API_KEY: '  ', LIVEKIT_API_SECRET: 's' })).toThrow();
  });
});
