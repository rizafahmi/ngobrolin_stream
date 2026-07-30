# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

See `README.md` for the runbook, the quality policy, and an explicit list of what has and has not been verified.

## The one invariant

A guest's LiveKit identity is the slug of their name, frozen into their token at minting time (`src/lib/identity.ts`).
Saved OBS scenes point at `/view?id=<slug>`, so **nothing may ever make that slug depend on runtime input**.
The display name a guest types is cosmetic and must stay that way.
Any change to slugging is a breaking change to every OBS scene the captain has saved.

## Sharp edges

- **The media server is LiveKit Cloud's free Build plan**, not the self-hosted config. `livekit.yaml` and `podman-compose.yml` are the documented alternative, kept for the day the show outgrows the free allowance. See the Cloud and self-hosting sections of README.
- **`PUBLIC_` variables are frozen into the bundle at build time**, so creating or editing `.env` changes nothing until you rebuild.
  The build now throws instead of shipping a bundle with no server address; see the gate at the top of `astro.config.mjs`, and `npm run mint` refuses when an existing `dist/` was built against a different address (`src/lib/built-bundle.ts`).
  Changing the media server therefore means `npm run build` plus a redeploy, and changing credentials means re-minting every guest link.
  Identities are unaffected, so saved OBS scenes survive both.
- **`token.ts` must not be imported by browser code.** It pulls in `livekit-server-sdk` and `node:crypto`. Browser-side token reading lives in `src/lib/jwt.ts` for exactly this reason.
- **LiveKit ships no macOS binaries** and its install script is Linux only. Build from source with the `/cmd/server` suffix; the bare module path fails with "build constraints exclude all Go files". See README.
- **Chrome withholds usable ICE candidates from pages that never call `getUserMedia`.** The OBS view page is one, so local browser testing of `/view` needs `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. Without it the page connects and is dropped seconds later with all ICE pairs failed. This is a local-testing artifact only.
- **Astro dev HMR kicks connected guests back to the join screen** when any source file changes. Verify live sessions against `npm run build && npx astro preview`.
- **In-room device switching must go through `Room.switchActiveDevice`**, never hand-rolled track replacement.
  It swaps the device inside the live publication (the track sid survives, so OBS browser sources never reload), defers a microphone swap while the track is muted, and re-sinks every remote audio element including tiles created later.
  Beware: `Room.getActiveDevice` returns a placeholder `'default'` for every kind before any switch has happened, which for cameras is not a real Chrome device id; see `activeInputId` in `src/scripts/join.ts`.
- **Create local tracks with one `createLocalTracks` call.** Calling `createLocalVideoTrack` and `createLocalAudioTrack` concurrently never settles.
- **Muted must suppress every speaking cue**, whatever the library or an analyser reports. That rule lives in `micCue` (`src/lib/mic-cue.ts`) and every cue must go through it: a guest who believes they are heard while muted is the failure the cues exist to prevent. The OBS view page shows no cues at all, by the same rule that keeps it bare - everything on it goes on air.
- **Cue painting is a per-frame job, tile structure is not.** `paintCues` in `src/scripts/join.ts` writes the speaking outline and the local level bar on every animation frame, and only when a value actually changed; `renderGrid` rebuilds tiles and must stay out of that loop, since re-attaching a track at frame rate flashes the video.
- **One analyser per session, re-bound rather than restarted.** The join card's bar and the local tile's bar are the same measurement, and the analyser follows the microphone by noticing that `mediaStreamTrack` changed - which is what an in-room device switch and every unmute do.
- Each OBS source needs its own identity (`obs-<slug>`). LiveKit evicts the older session on duplicate identity, so a shared viewer token would leave only the last browser source alive.

## Conventions

- Guest-facing copy is Indonesian. Code, comments, and docs are English.
- Development is test-first: write the failing test, watch it fail, then implement. Pure logic belongs in `src/lib/` so it is testable without a browser; `src/scripts/` holds only DOM and LiveKit wiring.
- Containers use podman and `podman-compose.yml`, never docker. The podman VM is stopped by default (`podman machine start`). The fast test loop uses the standalone `livekit-server --dev` binary instead, which needs no VM.
- Never claim something works without having observed it. The README's verification section is the standard to hold to.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
