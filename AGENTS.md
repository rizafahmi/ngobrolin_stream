# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

See `README.md` for the runbook, the quality policy, and an explicit list of what has and has not been verified.

## The one invariant

A guest's LiveKit identity is the slug of their name, frozen into their token at minting time (`src/lib/identity.ts`).
Saved OBS scenes point at `/view?id=<slug>`, so **nothing may ever make that slug depend on runtime input**.
The display name a guest types is cosmetic and must stay that way.
Any change to slugging is a breaking change to every OBS scene the captain has saved.

The same protection extends to the view URL itself.
A camera source is `/view?id=<slug>&t=<token>` with **no** `source` parameter, and that absence is load-bearing: it is what every scene saved before screen sharing existed relies on.
New source kinds are added as new parameter values, never by changing what the existing URL means - and a whole new kind of source gets a whole new page, which is why the composed stage is `/stage?t=<token>` rather than another `view` parameter.
`test/urls.test.ts` asserts both per-guest URLs as whole literal strings for this reason.

## Sharp edges

- **The media server is LiveKit Cloud's free Build plan**, not the self-hosted config. `livekit.yaml` and `podman-compose.yml` are the documented alternative, kept for the day the show outgrows the free allowance. See the Cloud and self-hosting sections of README.
- **`PUBLIC_` variables are frozen into the bundle at build time**, so creating or editing `.env` changes nothing until you rebuild.
  The build now throws instead of shipping a bundle with no server address; see the gate at the top of `astro.config.mjs`, and `npm run mint` refuses when an existing `dist/` was built against a different address (`src/lib/built-bundle.ts`).
  Changing the media server therefore means `npm run build` plus a redeploy, and changing credentials means re-minting every guest link.
  Identities are unaffected, so saved OBS scenes survive both.
- **Deleting `wrangler.jsonc` arms an accidental adapter conversion.** With no Wrangler config present, `wrangler deploy` falls back to framework detection and non-interactively runs `astro add cloudflare`, which installs the adapter and moves the site off `output: 'static'`. Wrangler skips detection entirely once it finds a real config file, so that file is a guard, not a convenience. `npx wrangler deploy --dry-run` validates it without credentials.
- **`token.ts` must not be imported by browser code.** It pulls in `livekit-server-sdk` and `node:crypto`. Browser-side token reading lives in `src/lib/jwt.ts` for exactly this reason.
- **LiveKit ships no macOS binaries** and its install script is Linux only. Build from source with the `/cmd/server` suffix; the bare module path fails with "build constraints exclude all Go files". See README.
- **Chrome withholds usable ICE candidates from pages that never call `getUserMedia`.** Both OBS pages are ones, so local browser testing of `/view` and `/stage` needs `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. Without it the page connects and is dropped seconds later with all ICE pairs failed. This is a local-testing artifact only.
- **Astro dev HMR kicks connected guests back to the join screen** when any source file changes. Verify live sessions against `npm run build && npx astro preview`.
- **In-room device switching must go through `Room.switchActiveDevice`**, never hand-rolled track replacement.
  It swaps the device inside the live publication (the track sid survives, so OBS browser sources never reload), defers a microphone swap while the track is muted, and re-sinks every remote audio element including tiles created later.
  Beware: `Room.getActiveDevice` returns a placeholder `'default'` for every kind before any switch has happened, which for cameras is not a real Chrome device id; see `activeInputId` in `src/scripts/join.ts`.
- **Create local tracks with one `createLocalTracks` call.** Calling `createLocalVideoTrack` and `createLocalAudioTrack` concurrently never settles.
- **Every publication must be filtered by track source before it is rendered.** A guest publishes up to four tracks and each OBS page is exactly one of two sources, so "belongs to this participant" is not enough - that assumption was a live bug, where a screen share silently replaced the guest's face mid-broadcast. The rule is `viewAcceptsTrackSource` in `src/lib/view-source.ts`, it covers audio as well as video, and both sets are disjoint. Anything new that renders a remote track goes through it.
- **livekit-client accepts `suppressLocalAudioPlayback` at the top level of its screen-capture options and never forwards it to `getDisplayMedia`** (see `screenCaptureToDisplayMediaStreamOptions` in the client). It has to go in the `audio` constraints instead, where it is a real constrainable property. Same shape of trap for anything else in `ScreenShareCaptureOptions`: check that mapping function before trusting a field exists in practice.
- **A screen track reads `screenShareEncoding`, not `videoEncoding`.** `computeVideoEncodings` switches on the source, so a `videoEncoding` passed for a screen share is silently ignored. One entry in `screenShareSimulcastLayers` yields two layers in total.
- **Publishing or unpublishing anything renegotiates the guest's connection, and OBS gets a softer layer for 10-15 seconds.** Measured after a screen share ends: the camera source is fed 360p, same track, never reloaded, then climbs back to 720p on its own. Re-asserting the subscription pin (`repin` in `src/scripts/view.ts`) does not close that window; do not "fix" it again without measuring first. README's verification section records the numbers.
- **Muted must suppress every speaking cue**, whatever the library or an analyser reports. That rule lives in `micCue` (`src/lib/mic-cue.ts`) and every cue must go through it: a guest who believes they are heard while muted is the failure the cues exist to prevent. The OBS view page shows no cues at all, by the same rule that keeps it bare - everything on it goes on air.
- **Cue painting is a per-frame job, tile structure is not.** `paintCues` in `src/scripts/join.ts` writes the speaking outline and the local level bar on every animation frame, and only when a value actually changed; `renderGrid` rebuilds tiles and must stay out of that loop, since re-attaching a track at frame rate flashes the video.
- **One analyser per session, re-bound rather than restarted.** The join card's bar and the local tile's bar are the same measurement, and the analyser follows the microphone by noticing that `mediaStreamTrack` changed - which is what an in-room device switch and every unmute do.
- Each OBS source needs its own identity - `obs-<slug>` for the face, `obs-<slug>.screen` for the screen, `obs.stage` for the composed source (one per show, not per guest). LiveKit evicts the older session on duplicate identity, so a shared viewer token would leave only the last browser source alive, and that applies to a guest's two sources as much as to two guests. The separator is a dot because a slug is only `[a-z0-9-]`, so no dash-joined suffix can be proven collision-free - and that is also what makes `obs.stage` provably safe against a guest called "Stage".
- **The composition is one pure function, called by both renders.** `compose()` in `src/lib/stage.ts` answers "what does the room look like now" from participants + who is sharing + which render is asking, and `layoutCells()` answers "where does each cell go". `src/scripts/stage.ts` (OBS) and `src/scripts/join.ts` (app) only draw the answer. Anything that changes what the show looks like changes `stage.ts` and nothing else; anything that makes the two renders disagree is a bug, because "what goes on air is what participants see" is the whole premise.
- **Subscription quality is a property of the slot, not of the page.** `slotSubscriptionQualityFor` in `src/lib/quality.ts`, and it must be **re-applied on every render**, not once on `TrackSubscribed`: a screen promoted to the stage has to upgrade and the faces it displaced have to drop. Both controllers guard the call with a per-`trackSid` last-applied map, because render also runs on resize and re-sending an identical preference is a signalling storm. The older `ViewContext` split (`obs` / `grid`) is still there and still correct for the per-guest pages; the tests assert the two agree so they cannot drift.
- **The composed OBS source must never subscribe to audio.** Not "attaches no audio element" - never pulls the track down, via `renderAcceptsTrackSource('obs', ...)` in `src/lib/stage.ts`. The captain's mix is per-guest faders and one composed leg would wreck it. The corollary is operational and lives in README: the per-guest camera sources therefore have to stay connected for their audio, so the stage source is always additive - about +1.35 Mbps for a three-guest show - and no OBS setting can make it cheaper than today.
- **A plain `<style>` in a `.astro` page is scoped, and JS-created elements never match it.** Astro rewrites `.cell` to `.cell:where(.astro-…)`. `src/pages/stage.astro` builds every cell in JavaScript, so it needs `<style is:global>`; this shipped as a bug where the page connected and subscribed correctly while rendering everything stacked in static flow down the left edge. Any future page that draws its own DOM has the same trap.

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
