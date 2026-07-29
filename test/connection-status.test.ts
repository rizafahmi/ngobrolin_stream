import { describe, expect, it } from 'vitest';
import { ConnectionState } from 'livekit-client';
import { connectionStatus } from '../src/lib/connection-status.ts';

describe('connectionStatus', () => {
  it('labels a healthy connection in Indonesian', () => {
    expect(connectionStatus(ConnectionState.Connected)).toEqual({
      state: 'connected',
      label: 'Tersambung',
    });
  });

  it('shows both reconnect flavours as one reconnecting state, since guests cannot act on the difference', () => {
    expect(connectionStatus(ConnectionState.Reconnecting).state).toBe('reconnecting');
    expect(connectionStatus(ConnectionState.SignalReconnecting).state).toBe('reconnecting');
  });

  it('marks a dropped connection clearly', () => {
    expect(connectionStatus(ConnectionState.Disconnected).state).toBe('disconnected');
  });

  it('falls back to connecting for any state it does not know', () => {
    expect(connectionStatus('something-new' as ConnectionState).state).toBe('connecting');
  });

  it('covers every ConnectionState the client can emit', () => {
    for (const state of Object.values(ConnectionState)) {
      expect(connectionStatus(state).label.length).toBeGreaterThan(0);
    }
  });
});
