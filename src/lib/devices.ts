/**
 * Device picker decisions.
 *
 * Everything here is pure so the choices - what to list, what to select, when to
 * offer a speaker picker at all - are testable without a browser. The DOM and
 * LiveKit wiring in `src/scripts/join.ts` only renders what these functions decide.
 */

/** The subset of MediaDeviceInfo these decisions need. */
export type DeviceInfo = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>;

export interface DeviceOption {
  value: string;
  label: string;
  selected: boolean;
}

/** Devices of one kind, minus Chrome's pre-permission placeholder stubs. */
function usableDevices(devices: DeviceInfo[], kind: MediaDeviceKind): DeviceInfo[] {
  return devices.filter((device) => device.kind === kind && device.deviceId !== '');
}

/**
 * Build the option list for one picker.
 *
 * When `activeId` is missing from the list (device unplugged, or nothing chosen
 * yet), the first device is selected instead: the first enumerated device is the
 * browser's default, and a picker must never show an empty selection.
 */
export function deviceOptions(
  devices: DeviceInfo[],
  kind: MediaDeviceKind,
  activeId: string | undefined,
  fallbackLabel: string,
): DeviceOption[] {
  const usable = usableDevices(devices, kind);
  const hasActive = usable.some((device) => device.deviceId === activeId);
  return usable.map((device, index) => ({
    value: device.deviceId,
    label: device.label || `${fallbackLabel} ${index + 1}`,
    selected: hasActive ? device.deviceId === activeId : index === 0,
  }));
}

/**
 * Whether to show a speaker picker at all.
 *
 * Both legs matter: Safari-based browsers expose no `setSinkId`, and a browser
 * that supports it may still enumerate zero outputs (no audio permission). A
 * picker that cannot switch anything is hidden, never disabled.
 */
export function offerSpeakerPicker(sinkSelectionSupported: boolean, devices: DeviceInfo[]): boolean {
  return sinkSelectionSupported && usableDevices(devices, 'audiooutput').length > 0;
}

/**
 * Which device of a kind should be active after a hot-plug event.
 *
 * Keeps the guest's choice while the device exists; when it disappears, falls
 * back to the first enumerated device (the browser default) so audio and video
 * land somewhere real instead of on a ghost id.
 */
export function resolveActiveDevice(
  preferredId: string | undefined,
  devices: DeviceInfo[],
  kind: MediaDeviceKind,
): string | undefined {
  const usable = usableDevices(devices, kind);
  if (preferredId !== undefined && usable.some((device) => device.deviceId === preferredId)) {
    return preferredId;
  }
  return usable[0]?.deviceId;
}
