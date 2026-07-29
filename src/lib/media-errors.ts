/**
 * Turning browser media failures into something a non-technical guest can act on.
 *
 * Chrome reports every getUserMedia failure as a DOMException whose `name` is the
 * only reliable signal; the `message` is English and often useless ("Permission
 * denied by system"). Mapping name to panel here keeps that translation testable and
 * out of the DOM code.
 */

/** Panels on the join card that a failure can route to. */
export type ErrorPanel = 'permission' | 'denied' | 'nodevice';

export interface MediaErrorVerdict {
  panel: ErrorPanel;
  /** Extra line to show, or null when the panel already explains the situation. */
  message: string | null;
}

export function classifyMediaError(error: unknown): MediaErrorVerdict {
  const name = error instanceof Error ? error.name : '';

  // The guest said no, or said no on a previous visit and Chrome remembered.
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { panel: 'denied', message: null };
  }

  // No camera or microphone exists, or none matches the requested constraints.
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { panel: 'nodevice', message: null };
  }

  // The hardware exists but something else holds it. In practice this is Zoom, Meet,
  // or a previous tab of this same page left open.
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      panel: 'nodevice',
      message: 'Kamera atau mikrofon sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.',
    };
  }

  return {
    panel: 'permission',
    message: `Gagal menyalakan kamera: ${describe(error)}`,
  };
}

/**
 * Message for a failure to join the room after media is already working.
 *
 * The distinction that matters to a guest is "your link is stale, ask for a new one"
 * versus "the network is unhappy, try again", because only the first one needs
 * somebody else to act.
 */
export function classifyJoinFailure(error: unknown): string {
  const message = describe(error);
  if (/token|unauthorized|permission|invalid/i.test(message)) {
    return 'Kode masuk di link ini ditolak server. Kemungkinan link-nya sudah kedaluwarsa - minta link baru ke Riza.';
  }
  return `Gagal masuk studio: ${message}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
