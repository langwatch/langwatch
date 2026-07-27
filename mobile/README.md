# LangWatch Ops mobile

An Expo / React Native client for the ops surfaces at `/ops` — dashboard,
queues, dead letters, anomalies, scheduler, the Foundry, the payload store and
projection replay — for when the operator has a phone and not a laptop. Targets
iOS; Android falls out of the same source.

It **monitors**. The only action it can take is the payload store cleanup sweep,
and even that is trialled first. See "What it deliberately cannot do".

Specs: [`specs/ops/mobile-ops-app.feature`](../specs/ops/mobile-ops-app.feature)
and [`specs/ops/mobile-ops-api.feature`](../specs/ops/mobile-ops-api.feature).

## How it talks to the server

It calls the **same `opsRouter` the web console calls**, over tRPC, through a
second mount at `/api/mobile/trpc` that authenticates a device-flow bearer token
instead of a session cookie. There is no REST mirror to keep in sync, and no
hand-written response types:

```ts
import type { MobileRouter } from "~/server/api/mobile-root";
export const trpc = createTRPCReact<MobileRouter>();
```

`~/*` is mapped in `tsconfig.json` to `../langwatch/src/*`, so `pnpm typecheck`
here checks every screen against the real procedures — their inputs, their
outputs and their error codes. A server-side change that would break a screen
breaks this typecheck instead of the screen. The import is type-only, so none of
the server reaches the bundle.

That mapping is why `mobile/tsconfig.json` mirrors a handful of the app's
compiler options and pulls in its ambient declarations: TypeScript checks the
server sources it walks into under *this* config, so anything that differs shows
up as an error in a file this project does not own. `@types/node` is a
devDependency for the same reason — without it the server's `ioredis` types
resolve against a different `EventEmitter`.

The mount serves `mobileRouter`, which is the ops namespace and nothing else —
see `langwatch/src/server/api/mobile-root.ts` for why a device token is scoped
rather than made a key to the whole product API.

## Running it

```bash
cd mobile
pnpm install        # its own workspace root, like langwatch/
pnpm start          # then press i for the iOS simulator
```

`pnpm typecheck` and `pnpm test` are the two checks. Tests cover `src/lib` —
instance-URL parsing, formatting, list ordering, the confirmation gate, session
expiry — which is deliberately free of React Native imports so it runs under
plain node with no native shims. Anything that renders a component would need
`jest-expo`; there is no component test yet.

## Signing in

The app never handles a password. It runs the same RFC 8628 device-authorization
flow the CLI uses (`langwatch/src/server/routes/auth-cli.ts`):

1. Enter the instance address — `app.langwatch.ai`, or your own host. Pasting a
   full ops URL out of a browser works; the app keeps the origin.
2. The app asks for a device code and shows a short code like `WDJB-MJHT`.
3. It opens the instance's `/cli/auth` page in a browser. You sign in there — so
   SSO, MFA and every other control the instance enforces stay enforced — and
   confirm the code matches.
4. The app polls until approval, then stores the token pair with
   `expo-secure-store` at `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: no keychain sync to
   another device.

Access tokens live an hour and are refreshed automatically. Refresh tokens rotate
on every use, so `sessionStore` collapses concurrent refreshes onto one in-flight
call — two screens each noticing an expired token would otherwise race and the
loser would hold a token the server had already retired. A rejected refresh
clears the keystore and returns to sign-in.

Your account needs ops access on the instance — the same allow-list the web
`/ops` routes check. An account without it gets an explanation on the settings
screen rather than a wall of permission errors, because `ops.getScope` answers
for a non-operator instead of failing.

## Pointing at a local instance

`pnpm dev` in `langwatch/` serves on `http://localhost:5560`, which the simulator
can reach — enter `localhost:5560` as the instance address.

Under [haven](../tools/thuishaven/README.md) the app is at
`https://app.<slug>.langwatch.localhost`.

## What it shows

| Tab | Content |
| --- | --- |
| **Overview** | Blocked, parked and drifting counters first; then throughput, latency and per-phase metrics; then Redis and process pressure; then clustered top errors. Refreshes every 10s while in front. |
| **Queues** | Queues ranked by trouble rather than by name, drilling into groups and then into a group's queued jobs. Paused keys and paused tenants appear as read-only state. |
| **Health** | Anomalies (hard tier first), every dead-lettered group across all queues, and blocked groups clustered by error. Rows expand in place. |
| **Storage** | Per-queue sampled totals, then a blob listing orderable by largest / stalest / unreferenced / longest-lapsed-lease and filterable to one project. Plus the sweep. |
| **More** | Scheduler, the Foundry preset catalog, projection replay, settings. |

Every ranked blob listing reports how many payloads it examined and whether the
order is a best-of-sample — a keyspace of millions cannot be globally sorted
inside a request, and the screen says so rather than implying a true top-N.

## The one write: the cleanup sweep

Storage → *Run a cleanup sweep*.

The trial and the real sweep are the same `ops.runBlobCleanup` procedure with
`dryRun` flipped, so the tally you approve is the tally the sweep produced and
not an estimate arrived at some other way. The trial reports what would be
reclaimed, repaired and left pending, per queue. Only then does the reclaim
appear, and it stays disabled until you type `RECLAIM` exactly — no trimming, no
case folding. The server checks the same literal, so the typing makes the act
deliberate rather than being the security boundary.

## What it deliberately cannot do

The procedures exist on the router (it is the same `opsRouter`) and are gated by
`ops:manage` as always — but this app offers no control that calls one:

- unblock, drain, redrive, or move groups to and from the dead letter queue
- pause or unpause a pipeline key or a tenant
- start or cancel a projection replay
- write a feature flag
- delete a single payload
- emit a trace from a Foundry preset

A phone in a pocket is the wrong place to hold a control that redrives a queue or
rebuilds a projection. Job payloads are withheld for the same reason: the group
screen calls `ops.getGroupJobSummaries`, which reports a job's size and the
top-level keys of its payload and never its contents. `ops.getGroupJobs`, which
returns the payloads, is what the web console uses.

## Layout

```
mobile/
  app/                       expo-router routes
    _layout.tsx              providers + the signed-in gate
    (tabs)/                  Overview, Queues, Health, Storage, More
    queue/[queueName].tsx    one queue's groups and pauses
    group.tsx                one group: why it is stuck, and its jobs
    blobs/[queueName].tsx    payload listing
    scheduler.tsx  foundry.tsx  projections.tsx  settings.tsx
  src/
    api/trpc.ts              typed client, auth'd fetch, error copy
    auth/                    device flow, session store, provider, sign-in
    features/SweepSheet.tsx  trial then reclaim
    lib/                     pure logic — parsing, formatting, ordering, gates
    ui/                      theme and primitives
```

The server side is `langwatch/src/server/routes/mobile-trpc.ts` and
`langwatch/src/server/api/mobile-root.ts`.
