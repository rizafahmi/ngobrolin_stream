/**
 * The build must refuse to produce a bundle without `PUBLIC_LIVEKIT_URL`.
 *
 * This asserts against a real `astro build`, not against a validation helper in
 * isolation, because the whole point is that the build cannot succeed without the
 * variable. Public env vars are inlined at build time, so a bundle built without one
 * is permanently dead and the failure has to happen here or not at all.
 *
 * Each case builds a throwaway copy of the project in a temp directory: the real
 * worktree has a `.env`, and Vite loads it from the project root with no way to opt
 * out, so the absent-variable case needs a root that has no `.env` at all.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const scratchDirs: string[] = [];

/** A copy of the project with no `.env`, sharing the real `node_modules`. */
function scaffoldProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ngobrolin-build-env-'));
  scratchDirs.push(dir);
  for (const entry of ['package.json', 'astro.config.mjs', 'tsconfig.json', 'src']) {
    cpSync(join(projectRoot, entry), join(dir, entry), { recursive: true });
  }
  symlinkSync(join(projectRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return dir;
}

function runBuild(dir: string, overrides: Record<string, string> = {}): {
  status: number;
  output: string;
} {
  const env = { ...process.env };
  delete env.PUBLIC_LIVEKIT_URL;
  Object.assign(env, overrides);
  try {
    const output = execFileSync(
      process.execPath,
      [join(projectRoot, 'node_modules/astro/bin/astro.mjs'), 'build'],
      { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' },
    );
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('build-time environment gate', () => {
  it('fails the build and names the variable when PUBLIC_LIVEKIT_URL is missing', () => {
    const { status, output } = runBuild(scaffoldProject());
    expect(status).not.toBe(0);
    expect(output).toContain('PUBLIC_LIVEKIT_URL');
  }, 180_000);

  it('builds when PUBLIC_LIVEKIT_URL is present', () => {
    const dir = scaffoldProject();
    writeFileSync(join(dir, '.env'), 'PUBLIC_LIVEKIT_URL=ws://localhost:7880\n');
    const { status, output } = runBuild(dir);
    expect(output).not.toContain('PUBLIC_LIVEKIT_URL');
    expect(status).toBe(0);
  }, 180_000);

  // How a CI or deploy build supplies it: no `.env` on disk, the variable exported into
  // the build process instead.
  it('builds with no .env when PUBLIC_LIVEKIT_URL comes from the process environment', () => {
    const { status, output } = runBuild(scaffoldProject(), {
      PUBLIC_LIVEKIT_URL: 'wss://livekit.example.com',
    });
    expect(output).not.toContain('PUBLIC_LIVEKIT_URL');
    expect(status).toBe(0);
  }, 180_000);
});
