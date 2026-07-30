// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

// Build-time gate, not a runtime one: `PUBLIC_LIVEKIT_URL` is inlined into the bundle
// by Vite, so a build without it produces a site that can never connect and no later
// `.env` can fix. Astro's typed `env.schema` does not help here - it only validates a
// public client variable where a module imports `astro:env/client`, so a build with
// nothing but `import.meta.env` reads still succeeds. Hence an explicit throw.
// `PUBLIC_SITE_URL` is deliberately not required: only scripts/mint.ts reads it, and it
// has a documented default.
const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), 'PUBLIC_');
if (!env.PUBLIC_LIVEKIT_URL) {
  throw new Error(
    'PUBLIC_LIVEKIT_URL is not set. It is baked into the bundle at build time, so ' +
      'building without it ships a site that cannot connect to any LiveKit server. ' +
      'Create .env from .env.example, then build again.',
  );
}

// Static output on purpose: there is no backend. Guest tokens are minted ahead of
// time by scripts/mint.ts and carried in the URL, so the built site is a folder of
// plain files that can sit on any free static host.
export default defineConfig({
  output: 'static',
  server: { port: 4321, host: true },
  devToolbar: { enabled: false },
});
