/**
 * Connection state to the badge shown in the room header.
 *
 * LiveKit distinguishes signal reconnection from full reconnection. A guest cannot
 * do anything different about either, so both collapse to one "reconnecting" state
 * and one Indonesian label.
 */
import { ConnectionState } from 'livekit-client';

export type StatusState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export interface Status {
  /** Drives the dot colour via the data-state attribute. */
  state: StatusState;
  label: string;
}

const STATUSES: Record<string, Status> = {
  [ConnectionState.Connected]: { state: 'connected', label: 'Tersambung' },
  [ConnectionState.Connecting]: { state: 'connecting', label: 'Menyambung...' },
  [ConnectionState.Reconnecting]: { state: 'reconnecting', label: 'Menyambung ulang...' },
  [ConnectionState.SignalReconnecting]: { state: 'reconnecting', label: 'Menyambung ulang...' },
  [ConnectionState.Disconnected]: { state: 'disconnected', label: 'Terputus' },
};

export function connectionStatus(state: ConnectionState): Status {
  return STATUSES[state] ?? { state: 'connecting', label: 'Menyambung...' };
}
