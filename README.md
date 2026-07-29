# Ngobrolin Stream

A small, self-owned replacement for the parts of vdo.ninja that the Ngobrolin podcast actually uses.

Guests open a permanent link, pick their camera and microphone, and join.
Each guest becomes an independent, full-quality source that OBS Studio pulls in as its own browser source.
OBS keeps doing the compositing, so the existing scenes, transitions, and donatex/Notable overlays are untouched.

This is a personal tool for one show.
There are no accounts, no billing, and no multi-tenancy, and there never will be.

## How it works

- **LiveKit** is the SFU. Every guest uploads exactly one stream to the server, no matter how many other people are in the room. A peer-to-peer mesh would make each guest upload one copy per participant, and the guests' connections are far worse than the captain's.
- **The site is static, with no backend.** Guest tokens are long-lived and minted ahead of time by a CLI script, then embedded in permanent links. This is the same idea as vdo.ninja's `&push=ALICE`, and it is what lets the site deploy to any free static host.
- **OBS consumes one browser source per guest**, so the captain keeps full per-person control of the layout.
- **Identities are frozen at minting time.** A guest's LiveKit identity is a slug of their name, stored inside their token. Nothing the guest types can change it, so a saved OBS scene keeps working week after week.

### Quality: OBS gets the good copy, guests get thumbnails

Guests publish 720p30 with simulcast, in three layers (180p, 360p, 720p).

- The **OBS page** subscribes at `VideoQuality.HIGH` and pins 1280x720. That frame goes on air.
- The **in-room grid** subscribes at `VideoQuality.LOW` and pins 320x180. Guests only need to see faces well enough to hold a conversation.

Verified locally: the same guest decodes at 1280x720 in the OBS page and 320x180 in another guest's grid, simultaneously.

Audio is 48 kbps mono Opus with RED on and DTX explicitly off.
DTX clips the first syllable after a pause, which sounds like a dropout in a recording.

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

For each name it prints two links:

- **The guest link**, `https://.../?t=<token>`. Send this to the guest. They keep it forever.
- **The OBS browser source URL**, `https://.../view?id=budi-santoso&t=<token>`. This goes into OBS.

Tokens last five years by default.
Use `--ttl-days` to change that.

Re-running `mint` for the same name produces a **new token but the same identity**.
That means a saved OBS scene keeps working: only the `t=` part of the URL needs replacing, and the `id=` part never changes.

The two tokens are deliberately different.
The guest token can publish and subscribe.
The OBS token can only subscribe, so if that link ever leaks, the worst case is somebody watching, not somebody appearing on the show.
Each OBS source also gets its own identity (`obs-budi-santoso`), because LiveKit disconnects the older session when a duplicate identity connects, and one shared viewer token across four browser sources would leave only the last one alive.

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

The page renders nothing but the video: no names, no borders, no controls, no spinners.
When something is wrong it stays black, which is the right failure mode mid-recording.
Append `&debug=1` while setting up to get a small diagnostic overlay; never leave it on for a show.

Once the sources exist, the scene is permanent.
The same URLs keep working next week.

## Running a show

1. Start the LiveKit server, or confirm the hosted one is up.
2. Open OBS. The browser sources reconnect on their own; they stay black until each guest joins.
3. Send each guest their permanent link, or let them use the one they already have.
4. Each guest opens the link, presses **Izinkan Kamera & Mikrofon**, checks that the green bar moves when they speak, then presses **Masuk Studio**.
5. Guests see each other in a plain grid. That is for conversation only and is not what goes on air.
6. Watch each OBS source come alive as its guest joins.

If a guest's connection drops and they rejoin, their OBS source recovers on its own.
Verified locally: a guest fully disconnected, closed the page, reopened their link, and changed their display name, and the OBS browser source, never reloaded, picked the feed back up at 1280x720.

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

LiveKit Cloud includes TURN, which is the reason to consider it if this becomes a recurring problem.

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

## Self-hosting

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

## What was verified, and what was not

Verified end to end, locally, against a real LiveKit server and real WebRTC media:

- Two guests in two independent browser contexts, publishing and receiving real audio and video.
- The quality split: the same guest decoding at 1280x720 in the OBS page and 320x180 in another guest's grid at the same time.
- Two OBS browser sources connected simultaneously without evicting each other.
- Identity stability across a full guest session restart, including a changed display name, with the OBS source never reloaded.
- The OBS page blanking when its guest leaves, and re-acquiring when they return.
- OBS connections staying invisible to guests, so nobody sees a ghost tile.
- The OBS page containing no accessible content at all beyond the video element.
- The join page's permission, denied, no-device, ready, and broken-link states, all rendering at identical card geometry so nothing shifts under the pointer.
- 82 unit tests over identity, token minting, URL shapes, CLI parsing, quality policy, grid layout, and error classification.

Not verified, and not claimed to work:

- **Behaviour across real NAT**, and whether any guest will need TURN. See the TURN section above.
- **Real OBS Studio.** The view page was verified in Chrome, the same engine OBS embeds, but OBS itself was never run. The browser-source settings above come from the documented behaviour of those options, not from observation.
- **The podman self-hosting path.** Written, never run.
- **Browsers other than Chrome.** The guests are all on desktop Chrome, so that is the only target, and there is no mobile layout. Testing used Chrome Canary, the only Chrome installed on this machine.
- **Sustained multi-hour recording**, thermal behaviour, or memory growth over a real show's length.

## Layout of the code

```
src/lib/            Pure logic, all unit-tested
  identity.ts         Name -> stable slug, room name, OBS identities
  token.ts            Token minting (Node only, imports the server SDK)
  jwt.ts              Browser-side token decoding, kept apart from token.ts
  urls.ts             Join and view link shapes
  quality.ts          Simulcast and subscription policy
  layout.ts           Grid columns, tile sizing, tile order
  media-errors.ts     getUserMedia and join failures -> Indonesian guidance
  connection-status.ts
  cli-args.ts         Argument parsing for the mint CLI
src/pages/          index.astro (join + room), view.astro (OBS source)
src/scripts/        Browser controllers for those two pages
scripts/mint.ts     The link-minting CLI
```

Guest-facing copy is Indonesian.
Code, comments, and this README are English.
