import { describe, expect, it } from 'vitest';
import {
  ROOM_NAME,
  STAGE_IDENTITY,
  guestIdentity,
  isObsIdentity,
  obsIdentity,
  slugifyGuestName,
} from '../src/lib/identity.ts';

describe('slugifyGuestName', () => {
  it('lowercases and dashes multi-word names', () => {
    expect(slugifyGuestName('Budi Santoso')).toBe('budi-santoso');
  });

  it('folds accents so one person cannot become two identities', () => {
    expect(slugifyGuestName('Ándre')).toBe(slugifyGuestName('Andre'));
  });

  it('collapses runs of punctuation and trims the edges', () => {
    expect(slugifyGuestName('  Sari -- W. ')).toBe('sari-w');
  });

  it('is idempotent, so re-minting an existing guest cannot drift', () => {
    const once = slugifyGuestName('Riza Fahmi');
    expect(slugifyGuestName(once)).toBe(once);
  });

  it('is stable across capitalisation and spacing changes between weeks', () => {
    expect(slugifyGuestName('budi   santoso')).toBe('budi-santoso');
    expect(slugifyGuestName('BUDI SANTOSO')).toBe('budi-santoso');
  });

  it('rejects names with nothing sluggable rather than minting an empty identity', () => {
    expect(() => slugifyGuestName('???')).toThrow(/Cannot derive a guest id/);
  });
});

describe('identities', () => {
  it('uses the bare slug for guests', () => {
    expect(guestIdentity('Budi Santoso')).toBe('budi-santoso');
  });

  it('gives each OBS source its own identity so LiveKit does not evict them', () => {
    expect(obsIdentity('budi-santoso')).toBe('obs-budi-santoso');
    expect(obsIdentity('sari')).not.toBe(obsIdentity('andre'));
  });

  it('distinguishes OBS identities from guest identities', () => {
    expect(isObsIdentity(obsIdentity('budi'))).toBe(true);
    expect(isObsIdentity(guestIdentity('budi'))).toBe(false);
  });

  it('leaves the camera OBS identity exactly as every saved scene already has it', () => {
    expect(obsIdentity('budi-santoso', 'camera')).toBe('obs-budi-santoso');
    expect(obsIdentity('budi-santoso', 'camera')).toBe(obsIdentity('budi-santoso'));
  });

  it('gives the screen source its own identity, or LiveKit would evict the camera one', () => {
    expect(obsIdentity('budi-santoso', 'screen')).not.toBe(obsIdentity('budi-santoso'));
    expect(isObsIdentity(obsIdentity('budi-santoso', 'screen'))).toBe(true);
  });

  it('separates the two with a character no slug can contain, so nothing can collide', () => {
    // A guest called "Budi Screen" slugs to `budi-screen`; a dash-joined suffix would
    // make their camera source and Budi's screen source the same LiveKit identity.
    expect(obsIdentity('budi', 'screen')).toBe('obs-budi.screen');
    expect(obsIdentity('budi-screen', 'camera')).not.toBe(obsIdentity('budi', 'screen'));
  });

  it('pins the room name, since every link ever minted embeds it', () => {
    expect(ROOM_NAME).toBe('ngobrolin');
  });
});

/**
 * The composed stage source is one per show, not one per guest, so it is the first
 * identity in this system that is not derived from anybody's name. It still has to be
 * provably unable to collide with one, because a collision would evict a live source
 * mid-recording.
 */
describe('the stage identity', () => {
  it('cannot collide with any guest identity, whatever they are called', () => {
    // The separator is a dot, and a slug is only [a-z0-9-]. So no name can produce it.
    expect(STAGE_IDENTITY).toContain('.');
    expect(() => slugifyGuestName(STAGE_IDENTITY)).not.toThrow();
    expect(slugifyGuestName(STAGE_IDENTITY)).not.toBe(STAGE_IDENTITY);
  });

  it('cannot collide with either of a guest’s two OBS identities', () => {
    for (const name of ['stage', 'obs stage', 'obs', 'panggung']) {
      const slug = slugifyGuestName(name);
      expect(obsIdentity(slug, 'camera')).not.toBe(STAGE_IDENTITY);
      expect(obsIdentity(slug, 'screen')).not.toBe(STAGE_IDENTITY);
    }
  });

  it('is recognised as an OBS connection rather than a guest', () => {
    expect(isObsIdentity(STAGE_IDENTITY)).toBe(true);
    expect(isObsIdentity(guestIdentity('stage'))).toBe(false);
  });

  it('is one identity for the whole show, not one per guest', () => {
    expect(STAGE_IDENTITY).toBe('obs.stage');
  });
});
