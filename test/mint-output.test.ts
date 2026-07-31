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
/** The same run with three guests, which is what the captain actually types. */
let threeGuests: string;

function mint(...names: string[]): string {
  return execFileSync(process.execPath, [join(dir, 'scripts/mint.ts'), ...names, '--base', BASE], {
    cwd: dir,
    env: {
      ...process.env,
      LIVEKIT_API_KEY: 'placeholder-api-key',
      LIVEKIT_API_SECRET: 'placeholder-api-secret-long-enough-for-signing',
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ngobrolin-mint-output-'));
  for (const entry of ['package.json', 'tsconfig.json', 'src', 'scripts']) {
    cpSync(join(projectRoot, entry), join(dir, entry), { recursive: true });
  }
  symlinkSync(join(projectRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
  output = mint('Budi Santoso');
  threeGuests = mint('Budi Santoso', 'Sari Dewi', 'Andre Wibowo');
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The URLs printed, in the order they appear. */
function printedUrls(text = output): string[] {
  return text.match(new RegExp(`${BASE}\\S+`, 'g')) ?? [];
}

describe('mint output', () => {
  it('names the guest and their frozen id', () => {
    expect(output).toContain('=== Budi Santoso  (id: budi-santoso)');
  });

  it('prints the guest link, the camera source, then the screen source, per guest', () => {
    const urls = printedUrls();
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

/**
 * The composed stage is one source for the show, not one per guest. Printing it inside
 * the per-guest block would invite the captain to add three of them, which is three
 * identical participants on the meter and only one of them ever visible.
 */
describe('the stage source URL', () => {
  const stagePattern = /^https:\/\/ngobrolin\.example\.com\/stage\?t=/;

  it('is printed exactly once for a single guest', () => {
    expect(printedUrls().filter((u) => stagePattern.test(u))).toHaveLength(1);
  });

  it('is still printed exactly once for a three-guest show', () => {
    expect(printedUrls(threeGuests).filter((u) => stagePattern.test(u))).toHaveLength(1);
  });

  it('comes last, after every guest, so it reads as a per-show line', () => {
    const urls = printedUrls(threeGuests);
    expect(stagePattern.test(urls.at(-1)!)).toBe(true);
  });

  it('is labelled so it cannot be mistaken for a guest source', () => {
    expect(output).toContain('OBS browser source URL (panggung):');
  });

  it('leaves every per-guest URL exactly where it was', () => {
    // Three guests, three URLs each, then one stage URL. Nothing shifted, nothing lost.
    const urls = printedUrls(threeGuests);
    expect(urls).toHaveLength(10);
    for (const [index, slug] of ['budi-santoso', 'sari-dewi', 'andre-wibowo'].entries()) {
      expect(urls[index * 3]).toMatch(/^https:\/\/ngobrolin\.example\.com\/\?t=/);
      expect(urls[index * 3 + 1]).toMatch(
        new RegExp(`^https://ngobrolin\\.example\\.com/view\\?id=${slug}&t=`),
      );
      expect(urls[index * 3 + 2]).toMatch(
        new RegExp(`^https://ngobrolin\\.example\\.com/view\\?id=${slug}&source=screen&t=`),
      );
    }
  });
});
