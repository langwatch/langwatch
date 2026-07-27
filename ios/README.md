# LangWatch Ops for iOS

A native client for the ops surfaces at `/ops` — the dashboard, the queues, dead
letters, anomalies, the scheduler, the Foundry, the payload store and projection
replay — for when the operator has a phone and not a laptop.

It **monitors**. The only action it can take is the payload store cleanup sweep,
and even that is trialled before it runs. Unblocking queues, redriving dead
letters, pausing tenants, flipping feature flags and starting projection replays
all stay in the web console, by design — see "What it deliberately cannot do".

Specs: [`specs/ops/ios-ops-app.feature`](../specs/ops/ios-ops-app.feature) and
[`specs/ops/mobile-ops-api.feature`](../specs/ops/mobile-ops-api.feature).

## Building

The `.xcodeproj` is generated rather than checked in — a `pbxproj` is a
merge-conflict machine and nothing in it is worth reviewing.

```bash
brew install xcodegen        # once
cd ios
xcodegen generate
open LangWatchOps.xcodeproj
```

Then pick a simulator and run. Requires Xcode 15 or later; the deployment target
is iOS 16 (Swift Charts and `NavigationStack`).

Tests:

```bash
cd ios
xcodebuild test -scheme LangWatchOps -destination 'platform=iOS Simulator,name=iPhone 15'
```

Signing is set to automatic with no team, which is enough for the simulator. For
a device, set `DEVELOPMENT_TEAM` in `project.yml` and regenerate.

## Signing in

The app never handles a password. It runs the same RFC 8628 device-authorization
flow the CLI uses (`langwatch/src/server/routes/auth-cli.ts`):

1. Enter the instance address — `app.langwatch.ai`, or your own host. Pasting a
   full URL out of a browser works; the app keeps the origin and drops the path.
2. The app asks for a device code and shows a short code like `WDJB-MJHT`.
3. It opens the instance's `/cli/auth` page in the browser. You sign in there —
   so SSO, MFA and every other control the instance enforces stay enforced —
   and confirm the code matches.
4. The app polls until approval, then stores the token pair in the keychain
   (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: no iCloud sync, readable
   while locked so a background refresh works).

Access tokens live an hour and are refreshed automatically; refresh tokens
rotate on every use, so `SessionStore` serializes refreshes through one actor to
stop two screens racing and retiring each other's token. A rejected refresh
signs the app out and clears the keychain.

Your account needs ops access on the instance — the same `ADMIN_EMAILS`
allow-list the web `/ops` routes check. An account without it gets a screen
saying so rather than a wall of errors.

## Pointing at a local instance

`pnpm dev` serves on `http://localhost:5560`, which the simulator can reach.
App Transport Security is left on for every real host; the only carve-out is
`NSAllowsLocalNetworking`, so plain http works for local development and nowhere
else.

Under [haven](../tools/thuishaven/README.md) the app is at
`https://app.<slug>.langwatch.localhost` — enter that as the instance address.
The simulator trusts the portless CA once `make haven setup` has run on the
host.

## What it shows

| Screen | Source |
| --- | --- |
| **Overview** | Blocked, parked and drifting counters first; then throughput, latency and per-phase metrics; then Redis and process pressure. Refreshes every 10s while in front, and stops when backgrounded. |
| **Queues** | Queues ranked by trouble rather than by name, drilling into groups and then into a group's queued jobs. Paused keys and paused tenants appear as state. |
| **Health** | Anomalies (hard tier first), every dead-lettered group across all queues, and blocked groups clustered by error. |
| **Storage** | Per-queue sampled totals, then a blob listing you can order by largest / stalest / unreferenced / longest-lapsed-lease and filter to one project. Plus the sweep. |
| **More** | Scheduler, the Foundry preset catalog, projection replay, settings. |

Every ranked blob listing says how many blobs it examined and whether the order
is a best-of-sample — a keyspace of millions cannot be globally sorted inside a
request, and the screen says that rather than implying a true top-N.

## The one write: the cleanup sweep

Storage → *Run a cleanup sweep*.

The trial and the real sweep run the same code on the server, so the tally you
approve is the tally the sweep produced and not an estimate arrived at some other
way. The trial reports what would be reclaimed, repaired and left pending, per
queue. Only then does the reclaim appear, and it stays disabled until you type
`RECLAIM` exactly — no trimming, no case folding. The server checks the same
literal, so the typing makes the act deliberate rather than being the security
boundary.

## What it deliberately cannot do

These are absent from the mobile API as well as from the app, so a modified
client gains nothing:

- unblock, drain, redrive, or move groups to and from the dead letter queue
- pause or unpause a pipeline key or a tenant
- start or cancel a projection replay
- write a feature flag
- delete a single payload
- emit a trace from a Foundry preset

A phone in a pocket is the wrong place to hold a control that redrives a queue or
rebuilds a projection. Job payloads are withheld for the same reason: the app
shows a job's size and the top-level keys of its payload, never its contents.

## Layout

```
ios/
  project.yml                     XcodeGen definition
  LangWatchOps/
    App/                          entry point, root navigation, AppModel
    Core/                         networking, models, session, keychain, formatting
    Components/                   stat tiles, loading and error states
    Features/
      SignIn/                     device-authorization flow
      Dashboard/                  overview and top errors
      Queues/                     queues, groups, jobs
      Health/                     anomalies, dead letters, blocked-by-error
      PayloadStore/               blob listing, blob detail, the sweep
      Scheduler/                  schedules, read-only
      Foundry/                    preset catalog, read-only
      Projections/                replay status, history, catalog — read-only
      More/                       navigation and settings
    Resources/                    Info.plist, asset catalog
  LangWatchOpsTests/              decoding, error mapping, formatting, confirmation gate
```

The server side lives in `langwatch/src/server/routes/ops-mobile.ts` and
`langwatch/src/server/app-layer/ops/mobile-ops.service.ts`.
