/**
 * Minting must refuse when the already-built `dist/` was compiled against a different
 * LiveKit address than the one configured now.
 *
 * This asserts against a real `astro build` and a real `scripts/mint.ts` run, because
 * the thing under test is whether the address that Vite inlined into a minified,
 * content-hashed bundle can still be found and compared. A fake `dist/` would prove
 * nothing about that.
 *
 * The scaffolding is the same trick as test/build-env.test.ts: a throwaway copy of the
 * project in a temp directory, sharing the real `node_modules`, so the copy's `.env`
 * and `dist/` are entirely ours. Credentials here are obvious placeholders; minting
 * only signs a token and never talks to a server.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const scratchDirs: string[] = [];

const BUILT_URL = 'ws://localhost:7880';
const OTHER_URL = 'wss://example-project.livekit.cloud';
const PLACEHOLDER_KEY = 'placeholder-api-key';
const PLACEHOLDER_SECRET = 'placeholder-api-secret-long-enough-for-signing';

function scaffoldProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ngobrolin-mint-stale-'));
  scratchDirs.push(dir);
  for (const entry of ['package.json', 'astro.config.mjs', 'tsconfig.json', 'src', 'scripts']) {
    cpSync(join(projectRoot, entry), join(dir, entry), { recursive: true });
  }
  symlinkSync(join(projectRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return dir;
}

function run(dir: string, args: string[], overrides: Record<string, string>): {
  status: number;
  output: string;
} {
  const env = { ...process.env, ...overrides };
  try {
    const output = execFileSync(process.execPath, args, {
      cwd: dir,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

function mint(dir: string, livekitUrl: string) {
  return run(dir, [join(dir, 'scripts/mint.ts'), 'Budi Santoso'], {
    PUBLIC_LIVEKIT_URL: livekitUrl,
    LIVEKIT_API_KEY: PLACEHOLDER_KEY,
    LIVEKIT_API_SECRET: PLACEHOLDER_SECRET,
  });
}

/** One built project, reused by the cases that need a `dist/`. */
let built: string;

beforeAll(() => {
  built = scaffoldProject();
  const build = run(
    built,
    [join(projectRoot, 'node_modules/astro/bin/astro.mjs'), 'build'],
    { PUBLIC_LIVEKIT_URL: BUILT_URL },
  );
  expect(build.status, build.output).toBe(0);
  expect(existsSync(join(built, 'dist'))).toBe(true);
}, 180_000);

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('mint against the built site', () => {
  it('mints normally when the built address matches the configured one', () => {
    const { status, output } = mint(built, BUILT_URL);
    expect(output).not.toMatch(/npm run build/);
    expect(status).toBe(0);
    expect(output).toContain('id: budi-santoso');
  }, 60_000);

  it('refuses, names both addresses, and exits non-zero when they differ', () => {
    const { status, output } = mint(built, OTHER_URL);
    expect(status).not.toBe(0);
    expect(output).toContain(OTHER_URL);
    expect(output).toContain(BUILT_URL);
    expect(output).toContain('npm run build');
    // No links may be printed when it refuses.
    expect(output).not.toContain('id: budi-santoso');
  }, 60_000);

  it('mints silently when nothing has been built yet', () => {
    const fresh = scaffoldProject();
    const { status, output } = mint(fresh, OTHER_URL);
    expect(status).toBe(0);
    expect(output).toContain('id: budi-santoso');
    expect(output).not.toMatch(/dist|npm run build/);
  }, 60_000);

  // A `dist/` that exists but has no recognisable address refuses. Such a build could
  // never connect to any server, so passing it through would hand out links against a
  // site that is already broken - and a rebuild, which the build gate forces to carry
  // an address, is the fix in both readings of the situation.
  it('refuses when dist exists but carries no recognisable address', () => {
    const dir = scaffoldProject();
    cpSync(join(built, 'dist'), join(dir, 'dist'), { recursive: true });
    rmSync(join(dir, 'dist/_astro'), { recursive: true, force: true });
    const { status, output } = mint(dir, OTHER_URL);
    expect(status).not.toBe(0);
    expect(output).toContain('npm run build');
  }, 60_000);
});
