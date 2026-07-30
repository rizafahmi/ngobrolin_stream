/**
 * `npm run deploy` must not be able to upload a stale `dist/`.
 *
 * The script is `npm run build && wrangler deploy`, and the `&&` is the whole point:
 * `PUBLIC_LIVEKIT_URL` is inlined at build time, so uploading a `dist/` that a build did
 * not just produce is how the site ends up talking to the wrong LiveKit server while
 * looking perfectly healthy. This asserts the ordering behaviour rather than the text of
 * the script: a failing build must stop the deploy before Wrangler runs at all.
 *
 * The scaffolding is the same trick as test/build-env.test.ts: a throwaway copy of the
 * project in a temp directory sharing the real `node_modules`, with no `.env`, so the
 * build gate in `astro.config.mjs` fails the build deterministically. A pre-seeded
 * `dist/` stands in for the stale build that must never reach Cloudflare - if the
 * ordering were wrong, Wrangler would find it and say so in the output.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const scratchDirs: string[] = [];

function scaffoldProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ngobrolin-deploy-'));
  scratchDirs.push(dir);
  for (const entry of [
    'package.json',
    'astro.config.mjs',
    'tsconfig.json',
    'wrangler.jsonc',
    'src',
  ]) {
    cpSync(join(projectRoot, entry), join(dir, entry), { recursive: true });
  }
  symlinkSync(join(projectRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist/index.html'), '<!doctype html><title>stale</title>\n');
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('the deploy script', () => {
  it('fails at the build and never reaches Wrangler when the build cannot succeed', () => {
    const env = { ...process.env };
    env.WRANGLER_SEND_METRICS = 'false';
    delete env.PUBLIC_LIVEKIT_URL;
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;

    let status = 0;
    let output = '';
    try {
      output = execFileSync('npm', ['run', 'deploy'], {
        cwd: scaffoldProject(),
        env,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      status = failure.status ?? 1;
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }

    expect(status).not.toBe(0);
    expect(output).toContain('PUBLIC_LIVEKIT_URL');
    // Wrangler prints a banner the moment it starts, before it even reaches its own
    // credential check, and names the assets directory once it reads one. Neither may
    // appear: Wrangler must never have run, so the stale dist/ was never looked at.
    // (The words "wrangler deploy" do appear regardless - npm echoes the script it ran.)
    expect(output).not.toContain('⛅');
    expect(output).not.toContain('assets directory');
    expect(output).not.toContain('Total Upload');
  }, 180_000);
});
