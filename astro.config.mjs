// @ts-check
import { defineConfig } from 'astro/config';

// Static output on purpose: there is no backend. Guest tokens are minted ahead of
// time by scripts/mint.ts and carried in the URL, so the built site is a folder of
// plain files that can sit on any free static host.
export default defineConfig({
  output: 'static',
  server: { port: 4321, host: true },
  devToolbar: { enabled: false },
});
