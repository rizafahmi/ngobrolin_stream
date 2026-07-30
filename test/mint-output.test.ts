/**
 * What `npm run mint` actually prints.
 *
 * The captain pastes these three lines straight into a chat message and into OBS, so
 * their shape is part of the product. This runs the real script in a throwaway copy of
 * the project - with no `dist/`, so the stale-build guard stays out of the way - and
 * reads its stdout. Credentials here are obvious placeholders; minting only signs a
 * token and never talks to a server.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'https://ngobrolin.example.com';

let dir: string;
let output: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ngobrolin-mint-output-'));
  for (const entry of ['package.json', 'tsconfig.json', 'src', 'scripts']) {
    cpSync(join(projectRoot, entry), join(dir, entry), { recursive: true });
  }
  symlinkSync(join(projectRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
  output = execFileSync(
    process.execPath,
    [join(dir, 'scripts/mint.ts'), 'Budi Santoso', '--base', BASE],
    {
      cwd: dir,
      env: {
        ...process.env,
        LIVEKIT_API_KEY: 'placeholder-api-key',
        LIVEKIT_API_SECRET: 'placeholder-api-secret-long-enough-for-signing',
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The URLs printed, in the order they appear. */
function printedUrls(): string[] {
  return output.match(new RegExp(`${BASE}\\S+`, 'g')) ?? [];
}

describe('mint output', () => {
  it('names the guest and their frozen id', () => {
    expect(output).toContain('=== Budi Santoso  (id: budi-santoso)');
  });

  it('prints three URLs: the guest link, the camera source, then the screen source', () => {
    const urls = printedUrls();
    expect(urls).toHaveLength(3);
    expect(urls[0]).toMatch(/^https:\/\/ngobrolin\.example\.com\/\?t=/);
    expect(urls[1]).toMatch(/^https:\/\/ngobrolin\.example\.com\/view\?id=budi-santoso&t=/);
    expect(urls[2]).toMatch(
      /^https:\/\/ngobrolin\.example\.com\/view\?id=budi-santoso&source=screen&t=/,
    );
  });

  it('leaves the first two outputs in the shape they already had', () => {
    // The guest link and the camera source URL are what the captain has already sent
    // out and already saved in OBS. Their labels are how those lines get recognised.
    expect(output).toContain('Link untuk tamu (kirim ini ke mereka):');
    expect(output).toContain('OBS browser source URL:');
    expect(output.indexOf('Link untuk tamu')).toBeLessThan(output.indexOf('OBS browser source URL:'));
  });

  it('labels the screen source so it is not mistaken for the camera one', () => {
    expect(output).toContain('OBS browser source URL (layar):');
    expect(output.indexOf('OBS browser source URL:')).toBeLessThan(
      output.indexOf('OBS browser source URL (layar):'),
    );
  });

  it('gives the camera and screen sources different tokens, or LiveKit evicts one', () => {
    const [, camera, screen] = printedUrls();
    const tokenOf = (url: string) => new URL(url).searchParams.get('t');
    expect(tokenOf(camera!)).not.toBe(tokenOf(screen!));
  });

  it('still says when the links expire', () => {
    expect(output).toMatch(/Berlaku sampai: \d{4}-\d{2}-\d{2}/);
  });
});
