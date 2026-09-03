# tRPC subscriptions on `apps/ui`'s transport

`dev/docs/plans/ui-family-move-manifests.md` ranks five families behind one
sentence: "tRPC subscriptions: apps/ui's transport declares none". Traces,
the experiments workbench, simulations + agent testing and the Langy layout
all open a live channel, and `apps/ui`'s transport had two HTTP links and
nothing else, so any of those families would have moved into a shell that
silently dropped its live updates. This slice gives that transport the same
subscription lane the platform host has, so the block is a block no longer.

It is a CLIENT slice. Nothing here mounts a server endpoint; the endpoint
already exists and this speaks to it.

## Survey

### The protocol is SSE, and it is ours, not tRPC's

The platform host routes EVERY subscription over Server-Sent Events. The
WebSocket transport that also exists (`platform/app/src/server/websockets/trpc-ws.ts`,
client half `wsLink` in `platform/app/src/utils/trpc-transport.ts`) carries no
subscriptions at all: it is opt-in per call via `op.context.useWS === true`,
and the only three call sites that set it are presence queries and the cursor
broadcast mutation. The outermost `splitLink` sends `op.type === "subscription"`
to `sseLink` before the WS split is ever consulted.

The wire format is HAND-ROLLED, not tRPC's own SSE format, which is why
`@trpc/client`'s stock `httpSubscriptionLink` (present in 11.18.0) cannot be
used and the link had to be ported:

```
GET  {origin}/api/sse/{procedure.path}?input={superjson.stringify(input)}
     Content-Type: text/event-stream; charset=utf-8
     Cache-Control: no-cache, no-transform
     X-Accel-Buffering: no

data: {superjson frame}          <- one frame, split across lines on \n
                                    and terminated by a blank line
: ping                           <- keep-alive comment every 25s
```

Frames are superjson-encoded and classified by the client:

| frame                             | meaning                                  |
| --------------------------------- | ---------------------------------------- |
| `{type:"connected"}`              | server ack, swallowed                    |
| `{type:"complete"}`               | stream finished, observer completes       |
| `{type:"error", message:"..."}`   | PROTOCOL error, observer errors           |
| `{type:"error", error:...}` (no `message`) | DOMAIN DATA — the Langy turn stream's terminal — delivered as data |
| anything else                     | data                                      |

That last row is the one thing in the port that is easy to get wrong and
expensive to get wrong: collapsing a domain `error` entry into a dead
subscription turns every live-watched Langy turn failure into a generic
unknown card while the typed cause is sitting on the wire. The classifier
is ported whole and tested on its own.

Server side: `platform/app/src/server/routes/sse.ts`, mounted at
`platform/app/src/server/api-router.ts:402` (`api.route("/", sseApp)`). It
takes the procedure path off the URL, builds a tRPC context, calls the
procedure through `router.createCaller`, and pumps either an AsyncIterable or
an Observable into the response stream. `raw.signal` is threaded into the
context so a browser that goes away actually interrupts a suspended
`await` inside the procedure.

### Auth on the channel is the browser session, and nothing else

`sse.ts` calls `getServerAuthSession({ app, req })` — the same better-auth
browser session every HTTP request uses. There is no token, no header, no
query credential. The client half carries it by construction: `EventSource`
sends the session cookie automatically **because the URL is same-origin**
(`getBaseUrl()` is `window.location.origin`). Cross-origin is the only way to
lose it, and cross-origin is also what `withCredentials` exists for — which the
host never sets, because it never needs to.

So the auth requirement for this slice reduces to one testable property: the
subscription URL's origin must equal the origin the HTTP lane resolves against.
That is what the suite asserts, and it is what the "auth dropped" sabotage
breaks.

The WebSocket upgrade path enforces the same seam from the other side —
`trpc-ws.ts` fails closed on an origin allowlist precisely because cookie auth
across origins is a CSRF vector. Same doctrine, different transport.

### Reconnect and backoff, as the host pins them

`platform/app/src/utils/sseLink.ts`, configured at
`platform/app/src/utils/trpc-transport.ts:70-73`:

- `maxReconnectAttempts: 5`
- `reconnectDelay: 1000`
- delay for attempt _n_ (1-based) = `reconnectDelay * 2 ** (n - 1)`
  → **1000, 2000, 4000, 8000, 16000 ms**
- a successful `onopen` resets the attempt counter to 0
- the 6th consecutive failure errors the observer with
  `SSE connection failed after 5 attempts` and closes
- `{result:{type:"started"}}` is emitted ONCE per subscription, on the first
  `onopen` only — a reconnect does not re-fire it (`startedSent` latch)
- teardown closes the `EventSource` AND clears a pending reconnect timer

### The consumers this unblocks

Ten call sites over nine procedures, all of them `op.type === "subscription"`:

| family                    | procedure                            | call site |
| ------------------------- | ------------------------------------ | --------- |
| traces (live view)        | `traces.onTraceUpdate`               | `platform/app/src/hooks/useTraceUpdateListener.ts:154` |
| traces-v2 (live indicator)| `tracesV2.onDiscoverUpdate`          | `platform/app/src/features/traces-v2/hooks/useTraceFreshness.ts:220` |
| traces (export progress)  | `export.onExportProgress`            | `platform/app/src/features/traces-v2/hooks/useExportTraces.ts:157` |
| simulations (export)      | `export.onScenarioRunExportProgress` | `platform/app/src/components/suites/useExportScenarioRuns.ts:145` |
| simulations / agent testing | `scenarios.onSimulationUpdate`     | `platform/app/src/hooks/useSimulationUpdateListener.ts:202` |
| experiments workbench     | `experiments.onExperimentUpdate`     | `platform/app/src/experiments-v3/hooks/useWorkbenchUpdateListener.ts:318` |
| langy layout              | `langy.onConversationUpdate`         | `platform/app/src/features/langy/hooks/useLangyConversationUpdateListener.ts:91` |
| langy chat                | `langy.onTurnStream`                 | `platform/app/src/features/langy/logic/langyChatTransport.ts:320` |
| presence                  | `presence.onPresenceUpdate`          | `platform/app/src/features/presence/hooks/usePresence.ts:73` |
| presence (cursors)        | `presence.onPresenceCursor`          | `platform/app/src/features/presence/hooks/usePeerCursors.ts:48` |

Nine of the ten go through `useSSESubscription`
(`platform/app/src/hooks/useSSESubscription.ts`), a thin wrapper that turns
`onStarted` / `onData` / `onError` / `onStopped` into a connection-state enum
for the live indicators. It is a hook over `x.useSubscription`, so it needs
nothing from the transport beyond a working subscription lane.

The tenth, `langy.onTurnStream`, is the one that shapes the design: it calls
`trpcClient.langy.onTurnStream.subscribe(...)` on the VANILLA client, not on a
React hook. `apps/ui`'s transport hands features a `TRPCUntypedClient`, whose
`.subscription(path, input, observer)` is exactly that call by path — so the
lane has to work on the untyped client, not only through `@trpc/react-query`.

### `apps/ui`'s transport before this slice

`apps/ui/src/behavior/ui-feature-transport.ts` built one `splitLink` on
`op.context.skipBatch` over `httpLink` / `httpBatchLink`, both pointed at the
relative `"/api/trpc"`, superjson both ways, `maxURLLength: 4000`. Its own
docblock said subscriptions were "deliberately absent" and that a feature
needing one was the signal to move the configuration rather than guess at it.
This slice is that move.

### Where the link had to live, and why not in `apps/ui`

A tRPC link returns an `Observable`, and both the value (`observable()`) and
the type live in `@trpc/server/observable`. `apps/ui` does not depend on
`@trpc/server` — `apps/ui/node_modules/@trpc` holds `client` and `react-query`
only, and the repo root has no `@trpc` at all — so a link written inside
`apps/ui` would need a new dependency and a lockfile change.

`packages/platform-api-client` already depends on `@trpc/client` **and**
`@trpc/server` at the same pinned 11.18.0, already owns "the browser's one
typed tRPC client for the platform API", and is the package both shells
import. The link went there, and this slice therefore added no dependency to
any package and needed no lockfile change of its own.

Two things the package cannot have, and how they are handled:

- **superjson**: not a dependency, and a reusable package should not pick the
  transformer anyway. The link takes a `transformer` with `stringify` / `parse`;
  `apps/ui` passes `superjson`, exactly the one the HTTP links already use.
- **`EventSource`**: not in Node, and not in jsdom either (checked: jsdom 30
  exposes no `EventSource`), so it is resolved from `globalThis` at connect
  time rather than at module load, and can be supplied explicitly. That is
  also the test seam, and it is the same shape `createUiFeatureApiClient`
  already uses for `fetch`.

## What was built

- `packages/platform-api-client/src/sse-subscription-link.ts` — the link.
  Ports `classifySseFrame` and the full connect / frame / reconnect / teardown
  behaviour of `platform/app/src/utils/sseLink.ts`, with the transformer and
  the `EventSource` constructor injected. Exports the two pins as named
  constants so their value is stated once.
- `packages/platform-api-client/src/feature-api.ts` — `ProcedureShape` gained a
  `subscription` variant mapping to `TRPCSubscriptionProcedure`, so a feature
  web package can declare a live procedure in its map at all. Without it the
  families being unblocked could not describe the procedures they subscribe to.
- `apps/ui/src/behavior/ui-feature-transport.ts` — the outer `splitLink` on
  `op.type === "subscription"`, in the host's order: the subscription split is
  outermost and the existing `skipBatch` HTTP split becomes its `false` branch,
  so no HTTP routing changed.
- `specs/ui/subscription-transport.feature` — 19 scenarios, all `@unit`, all
  bound. The parity checker reports the file `19/19 scenarios bound`.
- `packages/platform-api-client/tests/sse-subscription-link.unit.test.ts` (21
  tests) — the protocol: frames, the ambiguous `error` frame, the reconnect
  ladder, the started-once latch, teardown.
- `apps/ui/tests/ui-feature-transport-subscriptions.unit.test.ts` (11 tests) —
  the composition: which lane an operation takes, the origin the channel is
  opened against, and the same ladder observed end-to-end through the real
  client.

Both suites drive a fake `EventSource` on fake timers, so a drop, a reopen and
a frame are all things a test causes at an exact moment. In the `apps/ui`
suite the fake clock is scoped to the reconnect and teardown blocks only —
`httpBatchLink` schedules its flush on a timer, so freezing time for the
request-lane tests hangs them instead of speeding them up.

### Deliberate deviations from the twin

1. **No logger.** The host's link logs seven lines per subscription through
   `@langwatch/observability`, which `packages/platform-api-client` does not
   depend on. One of those lines is `logger.info({ path, input }, ...)` — it
   logs the subscription INPUT at info, and a subscription input can carry
   customer identifiers. That is not a line to port. Frames, reconnect timing
   and teardown are unchanged; only the narration is gone.
2. **Pins are defaults, not call-site arguments.** The host passes
   `maxReconnectAttempts: 5, reconnectDelay: 1000` explicitly at its one call
   site. Here they are the link's exported defaults, so the number is written
   once and both the package suite and the `apps/ui` suite observe the same
   sequence rather than re-stating it.

## Pins

| pin | value | held by |
| --- | ----- | ------- |
| subscription endpoint | `{origin}/api/sse/{path}` | `apps/ui` suite, URL assertion |
| input encoding | `?input=` + superjson | `apps/ui` suite |
| origin | same as the HTTP lane's | `apps/ui` suite, the auth property |
| max reconnect attempts | 5 | both suites, observed |
| backoff sequence | 1000, 2000, 4000, 8000, 16000 ms | both suites, observed as literals |
| `started` emitted | once per subscription, not per reconnect | package suite |
| domain `{type:"error", error}` | delivered as DATA | package suite |
| teardown | `close()` called, pending timer cleared | both suites |

## What the API-side mount will need (NOT built here)

`apps/api` serves no subscription endpoint today: no `/api/sse` route, no
WebSocket handler, and `apps/api/src/app-trpc/app-trpc.features.ts` mounts
query and mutation surfaces only. During the migration `apps/ui` is served
from the platform origin (`platform/app` depends on `@langwatch/ui`), so
same-origin `/api/sse/*` reaches the platform route — which is exactly what
this transport targets, the same way its HTTP links target the platform's
`/api/trpc`. No change of address is needed for any family to move.

When `apps/api` becomes the origin, that slice needs:

1. **The route.** A Hono `GET /api/sse/*` on the API app, doing what
   `platform/app/src/server/routes/sse.ts` does: path off the URL, superjson
   `input` off the query string, `createCaller`, pump AsyncIterable or
   Observable, `{type:"connected"}` / `{type:"complete"}` / error frames, 25s
   `: ping`, `raw.signal` into the context so an abandoned browser interrupts
   a suspended procedure.
2. **The error frame contract.** `sseErrorFrame` is ADR-045-shaped: a
   `HandledError` (directly or as a `TRPCError` cause) rides as
   `{type:"error", message: <code>, error: <serialized>}` and everything else
   degrades to the generic unknown. It has to move with the route or the
   client's classifier starts seeing shapes it does not know.
3. **Subscription procedures on the API root.** Nine of them, listed above.
   `app-trpc.features.ts` mounts by iterating one record, and its docblock is
   explicit that a surface enumerated anywhere else sits outside every audit —
   so the subscriptions go in that record, not beside it.
4. **The access declaration.** The platform route declares
   `handlerManagedAuth({ credential: "session", permissions: [] })` with the
   reason "user session validated in-handler"; per-message authorization is
   upstream in the procedure. The API mount needs the same declaration or the
   declared-check sweep will not see it.
5. **Origin, if it ever differs.** The moment the API is served from a
   different origin than the UI, the cookie stops riding along on its own:
   the link would need `withCredentials`, and the server would need CORS with
   credentials plus an origin allowlist — the fail-closed shape
   `trpc-ws.ts` already uses for the WS upgrade. Keeping the API same-origin
   avoids all of it, and that is the recommendation.

Nothing above is in scope here and none of it was touched.

## Which of the nine the record serves — all of them, since 2026-09-02

The subscription lane resolves a path on a caller built from the process's own
root, so a procedure is watchable exactly when its namespace is in
`apps/api/src/app-trpc/app-trpc.features.ts`. Every one of the ten call sites'
nine procedures is now in that record, and each is driven end to end over the
real `/api/sse` lane by the suite that mounted it:

| in the record | mounted by | proved by |
| ------------- | ---------- | --------- |
| `export.onExportProgress`, `export.onScenarioRunExportProgress` | the export mount, which owns its procedures and takes no ports | `api-trpc-collaborators.product.integration.test.ts` |
| `presence.onPresenceUpdate`, `presence.onPresenceCursor` | `PresenceTrpcApi`, which takes no ports; every answer is read off `ctx.app` | the identity half's suite |
| `traces.onTraceUpdate`, `tracesV2.onDiscoverUpdate` | `app-trpc.trace-group.ts` | `api-trpc-collaborators.trace-group.integration.test.ts` |
| `scenarios.onSimulationUpdate`, `langy.onConversationUpdate`, `langy.onTurnStream` | `app-trpc.agent-group.ts` | `api-trpc-collaborators.agent-group.integration.test.ts` |

What unblocked the last five was not the lane — the lane was finished when this
document was written — but the PORTS their transports take, which were supplied
by `platform/app/src/server/api/root.ts` while `platform/app` is deletes-only.
Each was resolved by composing the vertical in `apps/api` rather than by adding
a port group there:

- `traces` and `tracesV2` moved with the observability half.
- `scenarios` — `trackScenarioCreated`, `fireScenarioCreatedNurturing` and
  `captureException` are logged rather than sent, because this process composes
  no product-analytics sink and refusing would cost a customer the test case
  they just wrote to protect an email nobody was waiting on.
- `langy` / `langyEgress` — the two budgets meter through the process's own
  shared counter, the audit sink is the process's own, and the two gates
  (`refuseDemoProject`, `enforceLangyAccess`) are built in the composition
  because neither is a permission a declaration could describe.
  `LangyUiActionService` MOVED into `@langwatch/langy-server`, with the one
  thing it could not bring — the experiments workbench's action manifest —
  arriving as `LangyUiActionCatalogPort`. Its second platform consumer
  (`server/routes/langy-ui-actions.ts`) is left broken by the migration ruling.

Three properties the agent group's suite pins that the others do not: the
tenant-wide Langy signal is DROPPED for a conversation the caller does not own
(the user-scope gate, read off the broadcast payload rather than the input);
`onTurnStream` passes its watch gate and then completes cleanly on a process
with no Redis, which is the transport's documented answer — the browser falls
back to the Postgres conversation read rather than seeing an error; and the
request's own abort signal now rides the tRPC CONTEXT as well as the caller's
options, so a procedure resolved by a v10-shaped caller still learns the browser
is gone instead of holding its emitter listener forever.

## Not done, and why

- `platform/app` is unchanged — zero lines. The twin stays where it is; when
  the host's own transport is retired it can delete `sseLink.ts` and import
  this one, but that is a platform edit and platform is closed in this slice.
- No feature package was migrated onto the new lane. The lane exists and is
  tested; moving a family is that family's own slice.
