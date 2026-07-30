import { describe, expect, it } from 'vitest';

import { deviceOptions, offerSpeakerPicker, resolveActiveDevice } from '../src/lib/devices.ts';

/** Minimal stand-in for MediaDeviceInfo, which has no constructor in Node. */
function device(kind: string, deviceId: string, label = ''): Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'> {
  return { kind: kind as MediaDeviceKind, deviceId, label };
}

const MIXED_DEVICES = [
  device('videoinput', 'cam-1', 'FaceTime HD Camera'),
  device('videoinput', 'cam-2', 'Logitech BRIO'),
  device('audioinput', 'mic-1', 'MacBook Pro Microphone'),
  device('audiooutput', 'default', 'Default - Speakers'),
  device('audiooutput', 'out-1', 'MacBook Pro Speakers'),
  device('audiooutput', 'out-2', 'USB Headset'),
];

describe('deviceOptions', () => {
  it('lists only devices of the requested kind, in order', () => {
    const options = deviceOptions(MIXED_DEVICES, 'audiooutput', 'default', 'Speaker');
    expect(options.map((o) => o.value)).toEqual(['default', 'out-1', 'out-2']);
  });

  it('marks the active device as selected', () => {
    const options = deviceOptions(MIXED_DEVICES, 'videoinput', 'cam-2', 'Kamera');
    expect(options.find((o) => o.selected)?.value).toBe('cam-2');
  });

  it('falls back to selecting the first device when the active id is absent', () => {
    // The previously chosen device was unplugged: the picker must still show a
    // truthful selection rather than an empty control.
    const options = deviceOptions(MIXED_DEVICES, 'videoinput', 'cam-gone', 'Kamera');
    expect(options.map((o) => o.selected)).toEqual([true, false]);
  });

  it('selects the first device when no active id is known', () => {
    const options = deviceOptions(MIXED_DEVICES, 'audioinput', undefined, 'Mikrofon');
    expect(options[0]?.selected).toBe(true);
  });

  it('uses the device label when present', () => {
    const options = deviceOptions(MIXED_DEVICES, 'videoinput', undefined, 'Kamera');
    expect(options.map((o) => o.label)).toEqual(['FaceTime HD Camera', 'Logitech BRIO']);
  });

  it('numbers unlabeled devices with the fallback label', () => {
    const unlabeled = [device('videoinput', 'cam-1'), device('videoinput', 'cam-2')];
    const options = deviceOptions(unlabeled, 'videoinput', undefined, 'Kamera');
    expect(options.map((o) => o.label)).toEqual(['Kamera 1', 'Kamera 2']);
  });

  it('drops placeholder entries with an empty deviceId', () => {
    // Chrome returns such stubs before permission is granted; a picker entry that
    // cannot be switched to is worse than no entry.
    const withStub = [device('audiooutput', '', ''), ...MIXED_DEVICES];
    const options = deviceOptions(withStub, 'audiooutput', undefined, 'Speaker');
    expect(options.map((o) => o.value)).toEqual(['default', 'out-1', 'out-2']);
  });

  it('returns an empty list when no device of the kind exists', () => {
    expect(deviceOptions(MIXED_DEVICES, 'audiooutput', undefined, 'Speaker').length).toBe(3);
    expect(deviceOptions([], 'audiooutput', undefined, 'Speaker')).toEqual([]);
  });
});

describe('offerSpeakerPicker', () => {
  it('offers the picker when the browser supports sink selection and outputs exist', () => {
    expect(offerSpeakerPicker(true, MIXED_DEVICES)).toBe(true);
  });

  it('hides the picker when the browser cannot switch outputs', () => {
    expect(offerSpeakerPicker(false, MIXED_DEVICES)).toBe(false);
  });

  it('hides the picker when no output devices are enumerable', () => {
    const noOutputs = MIXED_DEVICES.filter((d) => d.kind !== 'audiooutput');
    expect(offerSpeakerPicker(true, noOutputs)).toBe(false);
  });

  it('ignores placeholder outputs with an empty deviceId', () => {
    const stubOnly = [device('audiooutput', '', '')];
    expect(offerSpeakerPicker(true, stubOnly)).toBe(false);
  });
});

describe('resolveActiveDevice', () => {
  it('keeps the preferred device while it is still present', () => {
    expect(resolveActiveDevice('out-2', MIXED_DEVICES, 'audiooutput')).toBe('out-2');
  });

  it('falls back to the first device of the kind when the preferred one vanished', () => {
    // The unplugged-headset case: sound must move somewhere audible, and the first
    // enumerated output is Chrome's system default.
    expect(resolveActiveDevice('out-gone', MIXED_DEVICES, 'audiooutput')).toBe('default');
  });

  it('falls back to the first device when nothing was preferred yet', () => {
    expect(resolveActiveDevice(undefined, MIXED_DEVICES, 'videoinput')).toBe('cam-1');
  });

  it('returns undefined when no device of the kind exists at all', () => {
    expect(resolveActiveDevice('out-1', [], 'audiooutput')).toBeUndefined();
  });
});
