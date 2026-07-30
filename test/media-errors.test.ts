import { describe, expect, it } from 'vitest';
import {
  classifyJoinFailure,
  classifyMediaError,
  classifyScreenShareError,
} from '../src/lib/media-errors.ts';

/** Chrome surfaces getUserMedia failures as a DOMException with a meaningful name. */
function domError(name: string, message = 'boom'): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('classifyMediaError', () => {
  it('sends a blocked guest to the unblock instructions', () => {
    expect(classifyMediaError(domError('NotAllowedError')).panel).toBe('denied');
  });

  it('treats a SecurityError the same as a denial, since it looks identical to a guest', () => {
    expect(classifyMediaError(domError('SecurityError')).panel).toBe('denied');
  });

  it('sends a guest with no webcam to the hardware panel', () => {
    expect(classifyMediaError(domError('NotFoundError')).panel).toBe('nodevice');
    expect(classifyMediaError(domError('OverconstrainedError')).panel).toBe('nodevice');
  });

  it('explains that another app is holding the camera, which is the common Zoom case', () => {
    const result = classifyMediaError(domError('NotReadableError'));
    expect(result.panel).toBe('nodevice');
    expect(result.message).toMatch(/aplikasi lain/i);
  });

  it('falls back to the permission panel with the raw reason for anything unrecognised', () => {
    const result = classifyMediaError(domError('WeirdError', 'kaboom'));
    expect(result.panel).toBe('permission');
    expect(result.message).toContain('kaboom');
  });

  it('never returns a message for the two panels that already explain themselves', () => {
    expect(classifyMediaError(domError('NotAllowedError')).message).toBeNull();
    expect(classifyMediaError(domError('NotFoundError')).message).toBeNull();
  });

  it('survives being handed a non-Error, which a rejected promise can be', () => {
    expect(classifyMediaError('nope').panel).toBe('permission');
  });
});

describe('classifyJoinFailure', () => {
  it('tells the guest their link is stale when the server rejects the token', () => {
    expect(classifyJoinFailure(new Error('invalid token'))).toMatch(/kedaluwarsa/i);
    expect(classifyJoinFailure(new Error('permission denied'))).toMatch(/kedaluwarsa/i);
  });

  it('does not blame the link for an ordinary network failure', () => {
    const message = classifyJoinFailure(new Error('could not establish signal connection'));
    expect(message).not.toMatch(/kedaluwarsa/i);
    expect(message).toContain('could not establish signal connection');
  });

  it('survives a non-Error rejection', () => {
    expect(classifyJoinFailure('nope')).toContain('nope');
  });
});

describe('classifyScreenShareError', () => {
  it('says nothing when the guest simply closed the picker', () => {
    // Chrome reports a cancelled share exactly like a denied permission. Cancelling is
    // the normal way to change your mind, so an alert here would be noise.
    expect(classifyScreenShareError(domError('NotAllowedError'))).toBeNull();
  });

  it('says so when the browser cannot share a screen at all', () => {
    const message = classifyScreenShareError(domError('DeviceUnsupportedError'));
    expect(message).toMatch(/browser/i);
    expect(message).not.toMatch(/undefined/);
  });

  it('names an unexpected failure rather than swallowing it', () => {
    expect(classifyScreenShareError(domError('AbortError', 'kaboom'))).toContain('kaboom');
  });

  it('survives a non-Error rejection', () => {
    expect(classifyScreenShareError('nope')).toContain('nope');
  });
});
