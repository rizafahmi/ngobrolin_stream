# Ngobrolin Stream

A small, self-owned replacement for the parts of vdo.ninja that the Ngobrolin podcast actually uses.

Guests open a permanent link, pick their camera and microphone, and join.
Each guest becomes an independent, full-quality source that OBS Studio pulls in as its own browser source.
OBS keeps doing the compositing, so the existing scenes, transitions, and donatex/Notable overlays are untouched.

This is a personal tool for one show.
There are no accounts, no billing, and no multi-tenancy, and there never will be.

## How it works

- **LiveKit** is the SFU, run on LiveKit Cloud's free Build plan. Every guest uploads exactly one stream to the server, no matter how many other people are in the room. A peer-to-peer mesh would make each guest upload one copy per participant, and the guests' connections are far worse than the captain's.
- **The site is static, with no backend.** Guest tokens are long-lived and minted ahead of time by a CLI script, then embedded in permanent links. This is the same idea as vdo.ninja's `&push=ALICE`, and it is what lets the site deploy to any free static host.
- **OBS consumes one browser source per thing**, so the captain keeps full control of the layout. That is one source per guest's face, plus one per guest's screen share. The site never composites; the scene does.
- **Identities are frozen at minting time.** A guest's LiveKit identity is a slug of their name, stored inside their token. Nothing the guest types can change it, so a saved OBS scene keeps working week after week.

### Quality: OBS gets the good copy, guests get thumbnails

Guests publish 720p30 with simulcast, in three layers (180p, 360p, 720p).

- The **OBS page** subscribes at `VideoQuality.HIGH` and pins 1280x720. That frame goes on air.
- The **in-room grid** subscribes at `VideoQuality.LOW` and pins 320x180. Guests only need to see faces well enough to hold a conversation.

Verified locally: the same guest decodes at 1280x720 in the OBS page and 320x180 in another guest's grid, simultaneously.

Audio is 48 kbps mono Opus with RED on and DTX explicitly off.
DTX clips the first syllable after a pause, which sounds like a dropout in a recording.

### A screen is not a face

A shared screen gets its own policy, because the numbers that suit a talking head are wrong for text.
It is published at **1920x1080 and 15 fps, 2.5 Mbps**, with a **640x360 at 400 kbps** second layer, both taken from LiveKit's own `ScreenSharePresets` rather than invented.
More pixels and fewer frames: a slide or an editor changes a few times a minute, and 1080p is what keeps small text readable after OBS scales it.
The track also carries `contentHint: 'detail'`, so the encoder keeps edges sharp instead of smearing them the way it would for motion.

**Two layers, not the camera's three.**
A screen has exactly two consumers, at opposite ends of the ladder: the OBS source takes 1080p, the in-room grid takes 640x360.
A middle layer would be encoded for nobody and would take its bitrate from the layer that goes on air.
Simulcast itself stays on, though - without it every guest's grid would have to pull the same 2.5 Mbps copy OBS takes, which is what would turn a screen share into a bandwidth problem.
See "What a screen share costs" below.

**Screen-share audio is captured**, and it reaches the screen source, never the camera one.
Playing a clip on air is a real part of the show, and routing it through the site gives the captain a clean digital copy rather than whatever the sharer's microphone picked up off their speakers.
It is encoded exactly like a microphone (48 kbps mono Opus, RED on, DTX off), but with the browser's three voice processors off: noise suppression and auto gain are trained on speech and audibly mangle music, and there is no room echo to cancel.
The feedback risk is handled where it can be: `suppressLocalAudioPlayback` stops a shared tab's audio coming out of the sharer's own speakers, so their microphone cannot hand the captain a second, delayed copy of the clip.
The remaining path - another guest hearing the clip through their speakers - is the same headphones question the show already has for every guest's voice, and every guest's microphone already runs with echo cancellation on.
The grid does play the screen audio, so guests can hear what they are reacting to; a guest discussing a clip they cannot hear is the worse failure.

## Prerequisites

- Node.js 24 or newer. The CLI is TypeScript run directly by Node, with no build step.
- A LiveKit server. For local development, the standalone binary below is enough.

### Installing the LiveKit server binary on macOS

The official install script at `get.livekit.io` is **Linux only**, and LiveKit publishes no macOS binaries in its GitHub releases.
On macOS the upstream path is Homebrew, which is not available here, so build the single binary from source with a local Go toolchain:

```sh
curl -sSL -o go.tgz https://go.dev/dl/go1.25.5.darwin-arm64.tar.gz
tar xzf go.tgz
export GOROOT="$PWD/go" GOPATH="$PWD/gopath" PATH="$PWD/go/bin:$PATH"
go install github.com/livekit/livekit-server/cmd/server@v1.13.4
cp "$GOPATH/bin/server" ~/.local/bin/livekit-server
livekit-server --version
```

Note the `/cmd/server` suffix.
Installing the bare module path fails with "build constraints exclude all Go files".
Go will fetch a newer toolchain automatically if the version you installed is too old.

## Local development

```sh
cp .env.example .env      # dev keys are already filled in
npm install
livekit-server --dev &    # API key "devkey", secret "secret", ws://localhost:7880
npm run dev               # http://localhost:4321
```

Then mint yourself a link and open it:

```sh
npm run mint -- "Budi Santoso"
```

Run the tests and the type check:

```sh
npm test
npm run check
```

### A caveat when testing locally in a browser

The OBS view page never calls `getUserMedia`, and Chrome restricts the ICE candidates it offers to pages that have not been granted camera or microphone permission.
On a single machine, where every peer sits behind the same NAT, that is enough to make the connection fail outright.

This is a local-testing artifact, not a property of the deployed system, where OBS reaches a real server over the internet.
If you are driving the view page with an automated Chrome, launch it with fake media so it behaves like a permitted page:

```
--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required
```

If you see the page connect and then immediately drop, check the LiveKit log for `removing participant without connection` and a list of failed ICE candidate pairs.
That is this problem, not a bug in the page.

Astro's dev server hot-reloads open pages when a source file changes, which silently kicks a connected guest back to the join screen.
When verifying a live session, build once and serve the built site with `npm run build && npx astro preview` instead.

## Minting links for the regular guests

Run this once per guest, ever:

```sh
npm run mint -- "Budi Santoso" "Sari Dewi" "Andre Wibowo" --base https://ngobrolin.example.com
```

For each name it prints three links:

- **The guest link**, `https://.../?t=<token>`. Send this to the guest. They keep it forever.
- **The OBS browser source URL**, `https://.../view?id=budi-santoso&t=<token>`. This is their face. It goes into OBS.
- **The OBS browser source URL for their screen**, `https://.../view?id=budi-santoso&source=screen&t=<token>`. This is a *second, separate* browser source, never a substitute for the first.

Tokens last five years by default.
Use `--ttl-days` to change that.

Re-running `mint` for the same name produces a **new token but the same identity**.
That means a saved OBS scene keeps working: only the `t=` part of the URL needs replacing, and the `id=` part never changes.
The camera URL is also unchanged by the arrival of screen sharing, byte for byte: the absence of `source=` is what means "camera", so every source saved before this feature existed keeps working untouched.

The tokens are deliberately different.
The guest token can publish and subscribe.
An OBS token can only subscribe, so if that link ever leaks, the worst case is somebody watching, not somebody appearing on the show.
Each OBS source also gets its own identity, because LiveKit disconnects the older session when a duplicate identity connects, and one shared viewer token across several browser sources would leave only the last one alive.
That applies to a guest's two sources as much as to two guests, so the identities are `obs-budi-santoso` and `obs-budi-santoso.screen`.
The dot is not decoration: a slug only ever contains `[a-z0-9-]`, so a dash-joined `obs-budi-santoso-screen` would be ambiguous with the camera source of a guest called "Budi Santoso Screen", and a dot cannot collide with anything.

Guest links contain a working credential.
Treat them like passwords and send them privately.

## Adding the sources in OBS

For each guest, once:

1. **Sources** -> **+** -> **Browser**.
2. Name it after the guest.
3. Paste that guest's `view?id=...` URL.
4. Set **Width** 1280, **Height** 720.
5. Tick **Control audio via OBS**. Without this you get the picture but no sound in your mix.
6. Untick **Shutdown source when not visible**. Leaving it ticked makes the guest's feed reconnect on every scene change, which costs a few seconds of black.
7. Leave **Refresh browser when scene becomes active** off unless you specifically want a hard reset on every switch.

The page renders nothing but the video: no names, no borders, no controls, no spinners, no speaking cues.
When something is wrong it stays black, which is the right failure mode mid-recording.
Append `&debug=1` while setting up to get a small diagnostic overlay; never leave it on for a show.

Once the sources exist, the scene is permanent.
The same URLs keep working next week.

### Adding a guest's screen source

Do this only for the guests who actually share - usually just the host.
An idle screen source costs no bandwidth, but it does spend participant-minutes for the whole recording; see the meters below.

1. **Sources** -> **+** -> **Browser**, as above.
2. Paste that guest's `view?id=...&source=screen&...` URL - the third link `mint` prints, not the second.
3. Set **Width** 1920, **Height** 1080. The screen is published at 1080p, and this source is the one place that resolution is worth having.
4. Tick **Control audio via OBS**, so a clip played on the shared screen reaches the mix.
5. Untick **Shutdown source when not visible**, same as the camera sources.

The screen source is **black whenever nobody is sharing**, which is its correct resting state rather than a fault.
It letterboxes rather than crops, because a guest's display is rarely the same shape as the source and the edge of a shared window is usually the thing being pointed at.
Compose the face and the screen in the scene however the show wants them; the site deliberately does not decide that.

## Running a show

1. Open the LiveKit Cloud usage dashboard for the project and read this month's bandwidth and participant-minutes meters. If either is past 70% of the month's allowance, move to the paid tier now, before recording, not during it.
2. Start the LiveKit server, or confirm the hosted one is up.
3. Open OBS. The browser sources reconnect on their own; they stay black until each guest joins.
4. Send each guest their permanent link, or let them use the one they already have.
5. Each guest opens the link, presses **Izinkan Kamera & Mikrofon**, checks that the green bar moves when they speak, then presses **Masuk Studio**.
6. Guests see each other in a plain grid. That is for conversation only and is not what goes on air.
   A tile is outlined in green while that person is talking, and a guest's own tile carries a thin level bar along its bottom edge, so the reassurance the join card's green bar gives does not stop at the door.
   A muted guest never gets either cue, whatever the server reports, because the one mistake worth designing against is somebody believing they are heard while muted.
   If the browser refuses to start audio playback, a separate line appears above the grid saying so and offering to fix it on click; that is a different message from nobody talking, and it never appears when there is nothing to hear.
7. Watch each OBS source come alive as its guest joins.
8. A guest who needs to show something presses **Bagikan layar** in the footer and picks a tab, a window, or their whole screen.
   Their screen appears as an extra cell in everybody's grid, next to their face, and in the captain's separate screen browser source at full resolution.
   Their face source is untouched throughout.
   Pressing the button again stops the share, and so does Chrome's own **Stop sharing** bar - both return everything to normal, and the footer button follows either way.
   A guest who changes their mind and closes the picker sees nothing happen, which is correct; a real failure gets a line above the grid.

**Why step 1 exists, and the risk it accepts.**
A measured two-hour show uses about 8.0 GB downstream and 720 participant-minutes.
The free Build plan allows 50 GB and 5,000 minutes per calendar month, resetting on the first, so four shows a month sit near 60% of both meters.
Comfortable, but the allowance is a hard cap and there is no headroom to discover mid-recording.

LiveKit's own documentation and its terms of service contradict each other about what actually happens at the ceiling, and neither states whether an already-connected participant is dropped mid-session.
Under the more favourable reading, what breaks is reconnection.
That turns a recoverable guest dropout - the case verified below, where a guest reopens their link and the OBS source picks them back up - into a permanent one for the rest of the recording.
The pre-show check is the whole mitigation: it is cheap, and it is the only moment at which moving to the paid tier costs nothing.

If a guest's connection drops and they rejoin, their OBS source recovers on its own.
Verified locally: a guest fully disconnected, closed the page, reopened their link, and changed their display name, and the OBS browser source, never reloaded, picked the feed back up at 1280x720.

### What a screen share costs

This is the part worth reading before turning screen sharing loose, because it is the one feature that can push a normal month past the free allowance.

The arithmetic below is the same method as the 8.0 GB figure above - nominal `maxBitrate` per subscribed leg, times duration - and it reproduces that figure exactly, which is why it is trusted here.
A screen share adds two kinds of leg: one 1080p copy to the captain's screen browser source, and one 640x360 copy to each *other* guest's grid.
The sharer does not download their own screen.
With three guests, one sharing:

| | rate added | per hour of sharing |
| --- | --- | --- |
| Screen source to OBS (1080p15 + audio) | 2.55 Mbps | 1.15 GB |
| Two other guests' grid cells (360p + audio) | 0.90 Mbps | 0.40 GB |
| **Total** | **3.44 Mbps** | **1.55 GB** |

Against the 50 GB monthly cap, for a four-show month of two-hour episodes:

| Sharing per episode | Episode | Four shows | Of the 50 GB cap |
| --- | --- | --- | --- |
| none | 8.00 GB | 32.0 GB | 64% |
| 30 minutes | 8.78 GB | 35.1 GB | 70% |
| one hour | 9.55 GB | 38.2 GB | 76% |
| the full two hours | 11.10 GB | 44.4 GB | **89%** |
| the full two hours, two guests sharing at once | 14.20 GB | 56.8 GB | **114% - over the cap** |

**Read the bold rows as the warning they are.**
A four-show month where every episode carries a full two-hour single screen share fits, at 89%, with no headroom left to discover anything with.
A four-show month where two guests share for the full two hours **does not fit**: it needs about 57 GB against a 50 GB allowance, and the overage lands as new connections failing partway through the last recording of the month.
Occasional sharing - a clip, a slide, twenty minutes of code - is comfortable.
A format built around a permanently shared screen is a reason to move to the paid tier before the month starts, not a reason to ration it mid-show.

**Participant-minutes move too, even when nobody shares.**
Each screen browser source is another participant for the whole recording:

| Sources in the scene | Per show | Four shows | Of the 5,000-minute cap |
| --- | --- | --- | --- |
| three camera sources | 720 min | 2,880 | 58% |
| plus one screen source | 840 min | 3,360 | 67% |
| plus three screen sources | 1,080 min | 4,320 | 86% |

So add screen sources only for the guests who actually use them.
An idle screen source subscribes to nothing and so costs no bandwidth at all, but three of them still move the minutes meter from 58% to 86% for a month in which nobody ever shared anything.

## TURN: what to do when one guest can never join

STUN alone fails behind symmetric NAT, CGNAT, and most corporate firewalls.
When that happens the guest needs a **relay**, and without one they simply cannot connect, no matter how many times they retry.

**How to tell this is what happened.**
The signature is specific:

- The guest reaches the join page, sees their own camera preview, and presses **Masuk Studio**.
- The status never becomes **Tersambung**, or it connects and drops within about 15 seconds.
- Everyone else in the same room is fine.
- The server log shows `removing participant without connection` for that guest, with every ICE candidate pair in state `failed`.

That last line is the confirmation.
A guest whose token is wrong fails differently: they get a message telling them the link is stale.

**What turning on relay requires.**
A TURN server is not free to set up:

- A public domain name pointing at the server.
- A TLS certificate for it. TURN over TLS on port 443 is the configuration that survives restrictive firewalls, because it looks like ordinary HTTPS.
- Open ports 3478/udp and 5349/tcp, or 443/tcp for the TLS variant.
- `turn.enabled: true` in `livekit.yaml`, plus the domain and ports. See the commented block in that file.

When LiveKit terminates TLS itself rather than sitting behind a proxy, it reads the certificate once at startup.
A renewal therefore needs a restart, and a restart disconnects every participant.
Schedule renewals away from recording day.

None of this applies on the current setup: **LiveKit Cloud includes TURN**, so the relay case is already covered without any of the work above.
This section is here for the self-hosted alternative.

**This is the part that has not been verified.**
Everything else here was tested end to end on one machine.
NAT traversal cannot be: a single laptop cannot reproduce symmetric NAT, CGNAT, or a corporate firewall.
Whether any particular guest needs TURN will only be known the first time one of them cannot join.

## Show-day fallback

Read this only when a guest cannot join minutes before recording.
Do not spend more than two minutes on diagnosis.

1. Have them close every other app using the camera (Zoom, Meet, Photo Booth), then reopen the link.
2. Have them try a different network, most reliably a phone hotspot. This alone fixes the NAT case.
3. If it still fails, fall back to vdo.ninja and move on. The guest publishes with `https://vdo.ninja/?push=budi&quality=0`, and OBS reads it with a browser source pointing at `https://vdo.ninja/?view=budi`.

This is insurance for the day something breaks, not a recommendation.

## The media server: LiveKit Cloud

The show runs on LiveKit Cloud's free Build plan.
It includes TURN, needs no server, no certificate, and no renewal schedule, and the measured load fits inside the free allowance with room to spare (see "Running a show" for the numbers and the one risk this accepts).

### Switching a local or self-hosted setup over to Cloud

1. Create the project in LiveKit Cloud and copy its `wss://` URL, API key, and API secret.
2. In `.env`, set `PUBLIC_LIVEKIT_URL` to that `wss://` address, and set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to that project's credentials. See `.env.example`, which carries both shapes.
3. **Rebuild.** `PUBLIC_LIVEKIT_URL` is baked in at build time, so `npm run build` must run again and the new `dist/` must be redeployed. Editing `.env` alone changes nothing that is already deployed. This is the trap to remember: the site will keep talking to the old server and look fine until a guest cannot connect.
4. **Re-mint every guest link** against the deployed site address:

   ```sh
   npm run mint -- "Budi Santoso" "Sari Dewi" "Andre Wibowo" --base https://ngobrolin.example.com
   ```

   This is not optional. The old tokens are signed with the old API secret and the Cloud project will reject them.
   Minting refuses outright while `dist/` still holds the old address, so step 3 cannot be silently skipped.
5. Send each guest their new link.

**Guest identities do not change.**
The identity is a slug of the name, and slugging does not depend on the server or the credentials.
Every saved OBS scene keeps working: in each browser source URL, only the `t=` half needs replacing, and the `id=` half stays exactly as it is.
So the work is one rebuild, one redeploy, one message per guest, and one paste per OBS source.

## Self-hosting: the documented alternative

Cloud is the current path; this is the one to come back to.
Self-hosting becomes the right answer if the show grows past three guests, past two hours, or past five recordings a month - past that, the free allowance stops fitting and the fixed cost of a server wins.

Switching back is a rebuild, a re-mint, and a redeploy: the same three steps as above with the values pointed the other way.
The choice is cheap to reverse in either direction, which is why it does not need to be made carefully.

`podman-compose.yml` and `livekit.yaml` are the documented path for running the SFU on a server the captain owns.

```sh
podman machine start          # the VM is stopped by default
podman-compose up -d
```

Then point `PUBLIC_LIVEKIT_URL` at `wss://your-host` and re-mint the links with the matching `--base`.

**Not verified.**
The compose file and config were written but never run.
Local verification used the standalone `livekit-server --dev` binary throughout, which is faster and needs no VM.
Expect to adjust `rtc.use_external_ip` and the port range for the actual host.

## Deploying the site

`npm run build` produces a static `dist/` that can go on any static host.

`PUBLIC_LIVEKIT_URL` is read at **build time**, not at runtime.
Changing which LiveKit server the site talks to means rebuilding, not editing a file on the host.

The API key and secret are never part of the build.
They are only used by `scripts/mint.ts` on the captain's own machine.

### Cloudflare Workers

The deployed host is Cloudflare Workers, configured by the committed `wrangler.jsonc`.

- **Build command:** `npm run build`, and it must have `PUBLIC_LIVEKIT_URL` available to it.
  It is inlined into the bundle at build time, so a build without it fails outright - see the gate at the top of `astro.config.mjs`.
  It can be supplied inline in the build command itself or as a Cloudflare build variable; a build variable is the tidier home, since it keeps the address out of the command line and lets it change without editing the command.
  It is not a secret: it is a public `wss://` address that every guest's browser can already see.
- **Output directory:** `dist`, declared once as `assets.directory` in `wrangler.jsonc`.
- **What gets uploaded:** static files only.
  There is no Worker entry point and there must not be one - `wrangler.jsonc` deliberately has no `main`, which is Wrangler's supported assets-only configuration.
  This site has no backend by design; guest tokens are minted ahead of time.

The Wrangler config also exists to stop Wrangler from guessing.
Without it, `wrangler deploy` detects Astro and runs `astro add cloudflare`, installing the adapter and converting the project away from `output: 'static'` - non-interactively, inside the build container.

To deploy by hand: `npm run deploy`, which is `npm run build && wrangler deploy`.
The build is not optional in that chain, because uploading a `dist/` built against a different LiveKit server is exactly the silent failure the build gate and the mint guard exist to prevent.

`npx wrangler deploy --dry-run` validates the configuration and resolves the assets directory without credentials, which is the way to check a config change without a real deploy.

## What was verified, and what was not

Verified end to end, locally, against a real LiveKit server and real WebRTC media:

- Two guests in two independent browser contexts, publishing and receiving real audio and video.
- **Three guests at once**, the real show size: one row of 458x258 tiles, with the page scrolling in neither axis.
- The quality split: the same guest decoding at 1280x720 in the OBS page and 320x180 in another guest's grid at the same time.
- Two OBS browser sources connected simultaneously without evicting each other.
- Identity stability across a full guest session restart, including a changed display name, with the OBS source never reloaded.
- The OBS page blanking when its guest leaves, and re-acquiring when they return.
- The in-room mic and camera buttons: the muted badge and the avatar placeholder appearing on the *other* guests' tiles, the OBS source going black while the camera is off, and everything recovering when it comes back on, including the grid re-applying its low-quality subscription to the republished track.
- Leaving with **Keluar** re-laying the remaining tiles out from three columns to two, and returning that guest to the join screen.
- OBS connections staying invisible to guests, so nobody sees a ghost tile.
- The OBS page containing no accessible content at all beyond the video element.
- The join page's permission, denied, no-device, ready, and broken-link states, all rendering at identical card geometry so nothing shifts under the pointer.
- The speaker picker on the join card: a non-default output chosen before joining reached the `sinkId` of a remote tile created after joining.
- In-room device switching through the **Perangkat** popover, against a real LiveKit server with Chrome's fake device set (three cameras, three mics, three outputs):
  - Camera switch mid-room kept the same publication (`trackSid` unchanged), the OBS view page kept playing 1280x720 with the same `MediaStreamTrack` and never reloaded, and the other guest's grid tile kept playing.
  - Mic switch while muted stayed muted, and the swap applied on unmute with echo cancellation, noise suppression, and auto gain all still active on the new device.
  - Speaker switch in-room re-sank the existing remote tiles, and a third guest joining afterwards got a tile playing through the switched output.
  - A `devicechange` event repopulated the pickers on both the join card and the open popover.
- What was *not* observed there: a physical hot-plug (the `devicechange` event was dispatched synthetically over static fake devices), and the hidden-picker path on a browser without `setSinkId` (the gate is `offerSpeakerPicker` in `src/lib/devices.ts`, unit tested, but no such browser was run).
- The in-room speaking cues, with two guests against a real server:
  - The speaking guest's own tile carried the outline and a moving level bar for all 50 samples of a 5-second window, and the other guest's page carried the outline on that same person's *remote* tile for all 50 samples of its own window, while neither page ever put an outline on the quiet guest.
  - The level bar appears only on the guest's own tile: on the other page the same element computed to `display: none`.
  - Muting stopped the outline and emptied the level bar on both pages within one sample, and the muted badge appeared, as it did before this change.
  - **Muted wins over a lying library**: with `isSpeaking` forcibly overridden to `true` on a muted remote participant, the outline stayed off for all 30 samples while the muted badge stayed on.
  - Unmuting restored both the outline and the level bar.
  - Turning the camera off kept the avatar placeholder behaviour intact, with the outline and level bar still correct over the placeholder.
  - The level bar followed the microphone across a track swap: replacing the live `MediaStreamTrack` inside the publication re-bound the analyser with no restart, which is the same path an in-room mic switch and every unmute take.
- The blocked-audio notice, **partly**: with `Room.canPlaybackAudio` driven to `false`, the notice appeared with its own wording, and a real keyboard activation of it called `Room.startAudio()` exactly once and cleared the notice while remote audio kept playing.
- **Screen sharing**, with two guests, a real `getDisplayMedia` capture, and both of one guest's OBS sources open at once. 55 checks, all passing, driven over CDP against a real LiveKit server.
  Read one caveat first, because it bounds everything below: the capture was a genuine `getDisplayMedia` call that Chrome resolved with `displaySurface: monitor` at 3840x2160, but **its frames were Chrome's synthetic test pattern rather than the actual desktop**, because `--use-fake-device-for-media-stream` substitutes the frame source for display capture as well as for the camera. The call, the track, the encoding, the publication, the subscription, and the delivery are all real; the pixels are not a real screen. Screenshots of the rendered OBS source and the guests' grids confirm the pattern being carried end to end.
  - **The bug this feature was built around is gone.** While the guest shared, their camera OBS source kept rendering the *same camera track* - identical `MediaStreamTrack.id` before, during, and after - and never subscribed to the screen share at all. Its subscription set stayed exactly `camera, microphone` while the guest's publication set grew to `camera, microphone, screen_share, screen_share_audio`.
  - The screen OBS source rendered the shared screen at **1920x1080**, subscribed only to `screen_share` and `screen_share_audio`, and was black with zero subscriptions before anyone shared.
  - The two OBS sources coexisted, connected as `obs-budi-santoso` and `obs-budi-santoso.screen`, neither evicting the other.
  - Both OBS pages had **no accessible content whatsoever** - empty `innerText` - before, during, and after the share. A screenshot of the rendered screen source at 1920x1080 shows the shared frame full-bleed with nothing else on it at all.
  - The camera page computes `object-fit: cover` and the screen page computes `contain`. The capture happened to be 16:9, the same shape as the source, so **no letterbox bar was ever actually drawn**; only the computed style was checked.
  - The negotiated RTP encodings were exactly two: `q` at 400 kbps / 15 fps / one-third scale and `h` at 2.5 Mbps / 15 fps / full scale. Capture ran at 1920x1080 at 15 fps, `contentHint` was `detail`, and `degradationPreference` was `maintain-resolution`.
  - The other guest's grid gained a third cell keyed `budi-santoso.screen`, ordered immediately after that guest's face, labelled "Layar Budi Santoso", letterboxed, and **decoding 640x360** - the low layer - while that same guest's face cell decoded 320x180 at the same moment. The grid did not scroll in either axis.
  - The screen cell carried the screen-share audio track, and carried no speaking outline, no level bar, and no muted badge.
  - The sharer saw **no cell for their own screen**, which is deliberate: sharing a whole display would otherwise nest the window inside itself.
  - Stopping from the footer button, and stopping the way Chrome's own bar does (ending the underlying capture, which is the exact code path), both unpublished every screen track, blanked the screen OBS source, removed the grid cell, and reset the footer button to "Bagikan layar". Sharing again afterwards worked.
  - Screen-share **audio was captured and published** as `screen_share_audio`, reached the screen OBS source's audio element, and reached the other guest's screen cell as a live track. Same caveat as the video: the audio came from Chrome's fake capture, not real system audio.
  - The footer button and the grid were checked visually as well as programmatically: the sharer's button reads "Layar dibagikan" with the same accent border the **Perangkat** button uses when open, the footer does not change width between the two labels, and the other guest sees three evenly sized cells reading "Budi Santoso", "Layar Budi Santoso", "Sari Dewi (kamu)" in that order.
  - Nothing already verified regressed: camera off still blanked the camera OBS source and coming back on still returned 1280x720, the muted badge still appeared with the speaking outline suppressed, and the device popover still opened and listed devices.
- **What was observed and is not ideal**, stated because it is what the captain will see: for about **10 to 15 seconds after a screen share ends**, the camera OBS source is fed the 360p simulcast layer instead of 720p. The track is never replaced and the source never reloads - it is the same feed, briefly softer - and it climbs back to 1280x720 on its own, measured at 15 seconds in two separate runs. The cause is the publisher's top layer dipping in frame rate through the unpublish renegotiation, so the SFU steps subscribers down and back up. Re-asserting the page's layer request on both edges was tried and **did not close the window**; the code says so where it lives. Starting a share did not produce the same dip in the runs that were measured for it.
- The Wrangler configuration, by `npx wrangler deploy --dry-run` after a real `npm run build`: Wrangler 4.115.0 read the 8 files in `dist/`, reported no bindings, and exited - with no framework detection, no `Detected Project Settings` prompt, and no attempt to run `astro add cloudflare`. No credentials were involved.
- 183 tests (`npm test`) over identity, token minting, URL shapes, CLI parsing, quality policy, grid layout, device picker decisions, error classification, and the microphone cue and blocked-audio rules, plus real-build checks that the build refuses a missing `PUBLIC_LIVEKIT_URL` and that minting refuses a `dist/` built against a different address, and that `npm run deploy` stops at a failing build before Wrangler ever runs. The screen-share additions include the track-source filtering rule that keeps a screen out of a camera source, that the camera view URL is unchanged byte for byte, the screen encoding policy, and a real `scripts/mint.ts` run asserting it prints three URLs in the right shapes.

Not verified, and not claimed to work:

- **Behaviour across real NAT**, and whether any guest will need TURN. See the TURN section above.
- **Real OBS Studio.** The view page was verified in Chrome, the same engine OBS embeds, but OBS itself was never run. The browser-source settings above come from the documented behaviour of those options, not from observation.
- **A real Cloudflare deploy.** Only the dry run above was performed; no credentials exist on this machine, so nothing was ever uploaded and no deployed URL has been loaded in a browser.
- **The podman self-hosting path.** Written, never run.
- **The LiveKit Cloud path.** The switching procedure above is written from the documented behaviour of the build-time variable and the token signing, both of which were verified locally; no Cloud project has been created, so the procedure itself has not been walked through. The usage numbers are measured locally, not read off a Cloud dashboard.
- **Browsers other than Chrome.** The guests are all on desktop Chrome, so that is the only target, and there is no mobile layout. Testing used Chrome Canary, the only Chrome installed on this machine.
- **Sustained multi-hour recording**, thermal behaviour, or memory growth over a real show's length.
- **A genuinely browser-blocked audio playback.** Chrome would not block it: once a page has been granted microphone permission Chrome treats it as allowed to autoplay, and neither `--autoplay-policy=document-user-activation-required` nor `user-gesture-required` produced a blocked state on a page that had joined the room. The notice's decision rule is unit tested and its wiring was verified against a driven `canPlaybackAudio`, but the browser condition that triggers it in the wild was never actually reproduced.
- **A screen share carrying real screen pixels.** See the caveat at the top of the screen-sharing entry above. Everything about the plumbing was exercised; the content was Chrome's test pattern. Whether a real 1080p desktop at 2.5 Mbps is legible enough on air is a judgement about the encoding policy, not something these runs measured.
- **Screen sharing a browser tab or a single window**, as opposed to a whole display. Chrome's `--auto-select-desktop-capture-source` selects the display. Tab and window capture use the same `getDisplayMedia` call and the same publication path, but were not driven.
- **`suppressLocalAudioPlayback`.** Its effect only exists for a tab capture, so it was never observed doing anything. It is set as a track constraint, which is the only place livekit-client actually forwards it - see the note in `src/lib/quality.ts`, which is the observation that matters - but that Chrome then honours it is reasoning.
- **Whether screen-share audio actually carries a clip audibly.** An audio track was captured, published, subscribed, and attached to real elements in both the OBS screen source and the other guest's grid cell, all verified. Nobody listened to it, and no clip was played into it.
- **Whether the grid playing screen audio causes audible feedback in practice.** The decision to play it, and the reasoning behind it, are above; the failure mode it accepts was never provoked.
- **Two guests sharing screens simultaneously.** The bandwidth table above includes that case arithmetically; it was never run.
- **A screen share over a real network.** Every leg above was loopback on one laptop, where 3.4 Mbps of extra downstream costs nothing. Whether a guest's uplink can carry 2.9 Mbps of screen on top of 2.5 Mbps of camera is exactly the kind of thing a single machine cannot answer.
- **Speaking cues driven by a real human voice.** Chrome's fake microphone beeps for only about 16% of each second, which is below LiveKit's default speaker threshold, and `--use-file-for-fake-audio-capture` produced silence in Chrome Canary here. The verification above therefore fed continuous synthetic audio into the live publication and ran the local server with a more sensitive `audio:` block (`active_level: 45`, `min_percentile: 5`, `update_interval: 200`). Real speech clears LiveKit's defaults comfortably, but that is reasoning, not an observation.

## Layout of the code

```
src/lib/            Pure logic, all unit-tested
  identity.ts         Name -> stable slug, room name, OBS identities
  token.ts            Token minting (Node only, imports the server SDK)
  jwt.ts              Browser-side token decoding, kept apart from token.ts
  urls.ts             Join and view link shapes, camera and screen
  view-source.ts      Which tracks belong to which OBS source, and the URL parameter
  quality.ts          Simulcast and subscription policy, camera and screen
  layout.ts           Grid columns, tile sizing, tile order
  media-errors.ts     getUserMedia and join failures -> Indonesian guidance
  mic-cue.ts          Speaking outline and level bar, with muted suppressing both
  audio-playback.ts   When to show the "browser blocked the audio" notice
  connection-status.ts
  cli-args.ts         Argument parsing for the mint CLI
src/pages/          index.astro (join + room), view.astro (both OBS sources)
src/scripts/        Browser controllers for those two pages
scripts/mint.ts     The link-minting CLI
wrangler.jsonc      Cloudflare deploy config: dist/ as static assets, no Worker code
```

Guest-facing copy is Indonesian.
Code, comments, and this README are English.
