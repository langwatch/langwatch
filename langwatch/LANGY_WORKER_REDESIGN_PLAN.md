# Langy worker (`services/langyagent`) — redesign plan

Actioning **every** finding and design direction from `LANGY_WORKER_REVIEW.md`. This is
the "exactly what changes" plan: file-by-file moves, the target tree, the naming, the
concern boundaries, the single worker→pool→app stream, and the visible secure-vs-local
split. **Plan only — no Go changed yet.**

Ground-truth anchors (verified this session): `app/app.go`, `app/ports.go`,
`cmd/root.go`, `cmd/manager.go`, `deps.go`, `serve.go`, `config.go`,
`adapters/httpapi/sink.go`, `adapters/workerpool/worker.go`,
`adapters/workerpool/opencode.go:787` (`streamSessionEvents`).

---

## 0. The through-line: one stream, worker → pool → app

This is the concern the review under-specified and the one you flagged. Everything else
in the redesign hangs off getting this contract named and owned.

### What exists today (and is actually good)

`streamSessionEvents` (opencode.go:787) already multiplexes **four** frame kinds onto
**one** `application/x-ndjson` response — the worker's `/chat` body — all serialised
through a single `writeMu` so nothing interleaves mid-line:

| Frame today | Source | Purpose |
|---|---|---|
| verbatim opencode event line | `scanner.Scan()` loop | Stream A (full fidelity) |
| `{"type":"langy.token","text":…}` | `textDeltaFromEvent` | Stream B fast-path (TTFT) |
| `{"type":"langy.tool",…}` start/end | `toolCallTracker.framesFor` | progressive tool cards |
| `{"type":"langy.progress"}` | heartbeat goroutine, `progressInterval` ticker | liveness through silent tool calls |

So the "constant stream of information sharing one connection" you want **already is the
transport**. Two problems, both about *ownership and naming*, not plumbing:

1. **The heartbeat is anonymous and the liveness lives somewhere else.** The worker emits
   `langy.progress`, but *nothing worker-side records liveness*. The control-plane
   `runTurn` (TS) is what turns "a frame arrived" into "refresh the Redis liveness key."
   That's the S3-G2 blocker: delete `runTurn` and the stream still flows but liveness goes
   dark. Liveness is a property *of the stream* but is maintained *off* the stream.
2. **The frame contract is un-named and re-parsed in three places** (Go producer,
   Go `turn_accumulator`, TS `parseAgentLine`) — review M2.

### Target: a named "worker output stream" whose freshness *is* liveness

One typed envelope, one producer, one documented consumer contract. The relay derives
liveness from **stream freshness** — "a frame of any kind arrived ⇒ alive; silence past N
⇒ dead" — so the separate Redis liveness key and the reconcile/sweep machinery collapse
(review K).

```
 opencode subprocess ── SSE /event ──►  WORKER (Runner)
                                          │  streamSessionEvents → typed OutputFrame envelope
                                          ▼
 ┌──────────────── one ndjson connection: POST /chat body ────────────────┐
 │  frame: heartbeat | partial(token) | tool(start/end) | log/progress    │
 │         | final(result) | error   —  ALL through one writeMu           │
 └────────────────────────────────────────────────────────────────────────┘
                                          │
                          WorkerPool (Go) forwards verbatim — adds nothing, owns nothing
                                          │  HTTP /chat stream
                                          ▼
                 CONTROL-PLANE RELAY (TS, the thin successor to runTurn):
                   • every frame  → refresh liveness (freshness = alive)   ← G2 / K
                   • partial      → append Redis token buffer              ← G1
                   • tool         → record durable tool event (S4)         ← G3
                   • final/error  → terminal
                                          │
                             Redis token buffer  ──►  browser via langy.onTurnStream
```

Concrete moves this implies (detail in §1, §6, §9):

- **Name the envelope in Go** — one `OutputFrame` type (`kind` + payload union) in
  `worker/` (or `domain/`), replacing the four ad-hoc `langy.*` structs. The heartbeat
  becomes `kind:"heartbeat"`, a *first-class* frame, not a magic `langy.progress`.
- **The envelope is an OPEN typed union, not just tokens (Alex).** Beyond `delta` tokens it
  carries arbitrary **UI cards interleaved mid-stream** — e.g. "show a trace-download box" —
  which must land *in order* relative to the surrounding tokens. The existing buffer already
  does this (`appendTool` flushes pending tokens first so a card lands after the prose
  before it); the union stays extensible (`delta | status | progress | milestone | tool |
  card:<kind> | heartbeat | final | error`) and **every** kind rides the same HMAC +
  `frameNonce` + stream-ordering — a card is not a special case.
- **One decode path.** After S3 deletes the TS `parseAgentLine`, the Go
  `turn_accumulator` reuses the producer's frame structs instead of a parallel
  `frameEnvelope` (M2). The TS relay decodes the *same* documented envelope.
- **Liveness = last-frame-time**, owned by the relay. The worker guarantees a frame at
  least every `heartbeatInterval`; the relay terminalizes on `> silenceWindow`. This is
  the single invariant that retires the Redis liveness key, the `reconcileAgentTurn`
  interval sweep, and most of `langy-turn-reconciler` (S3 #4).

> This section is the keystone. It is **G1 + G2 + K + M2** in one contract, and it is the
> precondition that makes the S3 TS deletions safe. Sequence it first.

---

## 0a. Frame authenticity — the `runToken` and per-frame HMAC

Every frame the worker sends back must prove **who it is** and **that it really is who it
says** — not once per stream, per **frame**. Design settled with Alex:

### What it defends (and what it does not)

- **Defends:** forgery (no `runToken` ⇒ no valid frame), cross-attribution (a frame for
  one conversation/user accepted as another), replay (cross-turn *and* intra-turn), and
  payload tampering.
- **Does NOT replace:** `LANGY_INTERNAL_SECRET` on the transport (this is a layer *inside*
  that already-authenticated channel), the `turnId` dispatch-idempotency fix (F /
  `ClaimTurn`), or `projectId` as the ClickHouse tenant key. Orthogonal to all three.

### Identity tuple — user-scoped, because Langy is the private surface

The platform is mostly shared; Langy is the one owner-private surface. Driving a worker is
always on behalf of the conversation's **owner user** (an admin viewing a transcript is a
read path, never this channel). So the binding is **user + conversation** at the core,
**project** as outer tenant context (consistent with the TenantId-first rule). Org adds
nothing user+project doesn't already pin.

Addressing follows suit: `/run` (and `/warm`, `/probe`) require
`{ projectId, userId, conversationId }` — never `conversationId` alone — and the worker
**rejects** a request whose triple ≠ the identity it was provisioned with.

### `runToken` lifecycle

1. **Mint** at `conversation_started`: 32 bytes from `crypto/rand`. Lives in the **event
   payload**.
2. **Server-only — projection-exclusion guard.** It must **never** appear in
   `langyConversationState` or `langyConversationTurn` (the folds the browser reads).
   A test asserts neither projection serialises it. This is the footgun: the render doc
   sits one step from the client.
3. **Provision** at spawn: injected into the worker via the credentials envelope (like
   `LLMVirtualKey`) — env var, dies with the subprocess, never readable again, **never
   re-sent on the wire** after spawn.

### Per-frame construction

```
frameNonce = 16B crypto-random, fresh per frame

// length-prefixed concat so the field boundaries are unambiguous — an attacker
// cannot shift a byte across adjacent variable-length fields to forge a colliding
// tuple. THIS is where "include the length" belongs: in the signing input, not on the wire.
signingInput = L(projectId)‖projectId ‖ L(userId)‖userId ‖ L(conversationId)‖conversationId
             ‖ L(turnId)‖turnId ‖ L(frameNonce)‖frameNonce ‖ L(payload)‖payload

mac = HMAC-SHA256(runToken, signingInput)

wire frame (one ndjson line) =
  { projectId, userId, conversationId, turnId, frameNonce, payload, mac }
```

No sequence number anywhere.

### Relay verification (per frame)

1. **Parse** the line as exactly one JSON object (strict — a glued `{…}{…}` line or a split
   frame fails here; that is the *framing* integrity check).
2. **Recompute** `mac` over the length-prefixed `signingInput`; **constant-time** compare
   (this is the *content* + field-boundary integrity check — any bit-flip/truncation/
   extension fails it).
3. `turnId` == the in-flight turn (closes cross-turn replay — no separate per-turn nonce
   needed, since `turnId` is inside the MAC and checked here).
4. `frameNonce` unseen this turn (bounded per-turn seen-set — closes intra-turn replay).
5. Only then: the frame counts as **liveness-fresh** and its payload is applied (append
   token buffer / record tool event / terminal).

### Liveness = *authenticated*-frame freshness

A frame refreshes liveness only **after** it passes verification (§0a steps 1–4). So the
liveness invariant from §0 tightens to: *a fresh **and authentic** frame ⇒ alive; silence
past the window, or a stream that stops producing valid frames ⇒ dead.* One check now
covers liveness and anti-spoofing together.

### Recovery (Alex's "drop, come back, recover" requirement)

- `runToken` is **durable** (event-sourced) → the relay reloads it on restart and resumes
  verifying the in-flight turn with **no re-handshake**.
- `turnId` is durable.
- The `frameNonce` seen-set is **soft** — it resets empty on a relay restart, leaving a
  narrow intra-turn replay window right after a crash. Acceptable: content frames are
  app-idempotent (token offset, tool-call id), so the only replayable-with-effect frame is
  a **heartbeat**, and a replayed heartbeat can at most extend a dead turn's liveness by a
  single window. (If we want that closed too, the optional timestamp-window check from §0
  covers it statelessly.)

### Framing vs content vs field-boundary — the corruption question, resolved

| Corruption | Caught by |
|---|---|
| Dropped/added newline (frames glued or split) | strict one-JSON-object-per-line parse |
| Bit-flip / truncation / extension inside a frame | HMAC over exact payload bytes |
| Byte shifted across a field boundary to forge a tuple | length-prefixed signing input |

### Go/TS touch points

- **Go (`worker/opencode` producer):** compute `frameNonce` + `mac` per `OutputFrame`;
  `runToken` + identity come from the spawn `Spec`. One HMAC per frame — cheap.
- **TS (relay):** verify per §0a before applying; dedup the `frameNonce` via a **shared
  Redis SET** (per turn, TTL'd — not in-memory, because any of the 3 instances may see the
  frame, see §0b); reload `runToken` on restart.

---

## 0b. The relay — a Hono service, and the 3-instance web app

Settled with Alex: the relay lives in TS as a **proper Hono service that listens** for the
worker's frames (**push**: worker → load-balancer → relay instance). Inbound dispatch to
the Go manager becomes **RPC-style POSTs** — `create_worker` / `revive_worker` /
`continue_worker` with a structured payload — with validation + body-parse + herr errors
reused from the shared middleware (the aigateway `HandleChat` → `pipeline` pattern), never
hand-rolled. Two clean RPC transports:

- **Go manager inbound** (control plane → manager): dispatch a turn. Fast ack, no long
  response body.
- **Hono relay inbound** (worker → relay): authenticated frames (§0a) land here.

**The hard part:** the web app runs **3 load-balanced instances**, so the worker's frames
hit *any* of them and one can die mid-turn. Alex's instinct — a per-tenant *ordered,
durable bus* where "if one falls, the next can't go ahead of it" — is right. And the good
news:

### It's already a Redis Stream — this is a REWIRE, not a rebuild (`langyTokenBuffer.ts`)

The durable buffer today (`server/services/langy/streaming/langyTokenBuffer.ts`) is
*already* exactly this: `XADD` with `MAXLEN ~` + TTL, `XRANGE` tail replay, `XREAD BLOCK`
live edge, **one stream per `(conversationId, turnId)`**, already multiplexing
delta/status/progress/milestone/tool/end/error. Its own header reasons "Why a Redis Stream
(not List + pub/sub)" and lands the replay→attach-gap argument. So the "bus" exists; that
single structure gives ordering + durability + failover with no NATS/Kafka. What changes:

- **Ordering is Redis's job, not the instance's** — unchanged. `XADD` → monotonic ids; the
  browser tails via `readTail` (`XRANGE`) then `follow` (`XREAD BLOCK`). One
  `(conv,turn)` = one stream; the single per-conversation worker serialises turns. "N+1
  can't precede N" is enforced by the log, independent of which instance wrote.
- **Writer moves (the real change).** Today `runTurn` (worker process, *pull*) calls
  `appendChunk`/`appendTool`/`markEnd`. In self-drive the **Hono relay** writes on each
  pushed, HMAC-verified frame. New per-frame step: dedup `frameNonce` via a shared per-turn
  Redis SET (`SADD`==0 ⇒ drop) → then the existing append. Relay instances stay stateless
  (all state — stream, dedup SET, `runToken` — is in Redis).
- **Failover = the worker's reconnect.** The worker holds **one streaming connection per
  turn** to the relay (the LB pins it → that turn's frames land on one instance, in order,
  for free). Instance dies → connection drops → worker reconnects → LB routes to a live
  instance → it resumes from the stream's last id; re-sent frames dropped by the
  `frameNonce` SET.
- **Liveness moves onto the stream (retires `langy:hb`).** Today liveness is a *separate*
  TTL key `langy:hb:{conv}:{turn}` that `runTurn` refreshes, read by
  `LangyTokenBuffer.liveness()`. Item K: the **heartbeat becomes a stream entry** and
  staleness = **age of the stream's last id** — so we delete `langy:hb`, `heartbeat()`, and
  the separate-key `liveness()`, and the sweep/reactor reads last-id age instead. One
  structure, one invariant, shared across instances by construction.

### The speed-vs-ordering tension dissolves

Alex flagged that tokens want speed while state frames want ordering — implying two paths.
With *one* ordered Redis Stream that already **is** the buffer the browser reads, tokens are
the fast path (`XADD` is microseconds; no bus hop, because the stream is the destination,
not a stage before it) **and** everything is ordered. No second mechanism.

### Why no separate bus (v1)

Per-frame work is tiny (verify + `SADD` + `XADD`) — there is no long per-instance
processing to lose on a crash. Durability is in Redis; the worker's reconnect + dedup covers
the gap. Add a real bus (NATS/Kafka) later only if fan-out/replay outgrows a single stream.

**Settled:** **push** (worker → relay via LB). The buffer is **already a Redis Stream** —
half of this exists. Sticky-by-conversation LB routing is an optional optimisation (cuts
cross-instance dedup contention), not required.

---

## 1. Target package layout (makes the boundaries scream)

The five boundaries you named — **transport · app · worker-pool · worker · workable
(runner)** — plus the secure-vs-local split, become visible in the tree instead of buried
inside one 2718-LOC `workerpool` package.

```
services/langyagent/
  cmd/
    root.go            composition root: picks Runner (local|sandboxed), wires deps
    manager.go         egress-guard composition (unchanged role)
  transport/           ← was adapters/httpapi.  DRIVING adapter: generic Run API,
                         ndjson OutputStream sink, /run /warm /probe /health
  app/                 orchestration. OWNS the pool (behind an interface). Generic
                         Job/Run/Result ports. Telemetry is a decorator, not methods.
  workerpool/          ← lifted out of adapters/. JUST the pool: registry, capacity,
                         idle reaper, replacement-race, shutdown/handoff.
  worker/              ← lifted out. ONE worker = one running job. Implements the
                         Worker port. Composes ↓ and produces the OutputFrame stream.
    opencode/          in-worker mechanics: opencode HTTP client, authproxy, session,
                         the streamSessionEvents → OutputFrame producer, toolCallTracker
    capability/
      github/          gateable GitHub capability (credential + API)      ← review F
  runner/              ← review L: the SCREAMING branch. One Runner/Sandbox interface.
    sandboxed/         prod: setuid UID + chown + egress + gVisor-assumed subprocess
    local/             dev: plain subprocess as the manager's own user (no setuid)
  egress/              ← was adapters/egress.  per-worker forward proxy (unchanged)
  controlplane/        ← was adapters/controlplane.  Finalizer + Revoker (outbound)
  domain/              pure value objects + errors + the OutputFrame envelope
  internal/telemetry/  ← review I. instruments facade, renamed metrics (see §7)
  assets/              //go:embed AGENTS.md + skills/                      ← review G
  config.go deps.go serve.go
  (deleted) langytracebridge/                                             ← review H
  (deleted) adapters/                     the adapters/ grouping dir goes away
  (deleted) entrypoint.sh asset-seeding                                   ← review G
  (deleted) telemetry/  (moved to internal/telemetry)
```

Why flatten `adapters/`? The hexagonal *roles* are already proven by the compile-time
`var _ app.X = (*Y)(nil)` checks; the `adapters/` prefix hides the interesting split (pool
vs worker vs opencode-mechanics vs runner) one level deeper than it should be. Driving vs
driven stays legible from the package docs and the port checks; the tree now shows the
*substance*.

---

## 2. App → WorkerPool → Worker → Workable — concerns, restated

| Layer | Owns | Does NOT own |
|---|---|---|
| **transport/** | auth, decode, body-limit, ndjson `OutputStream` | any turn/job logic |
| **app/** | orchestration of one Run; acquire→claim→post→stream→finalize; outcome mapping | how a worker is isolated; how frames are produced |
| **workerpool/** | registry keyed by conversation, capacity cap, idle reaper, replacement-race, shutdown/handoff | running a job; producing frames |
| **worker/** | one running job: claim mutex, PostMessage, StreamEvents → `OutputFrame`s | pooling; isolation substrate |
| **worker/opencode/** | opencode HTTP client, session, authproxy, frame production | scheduling; capacity |
| **runner/** | **the workable**: how a worker *process* is created & isolated | orchestration; pooling |

Three review directions become structural here:

- **C — "the App should CONTAIN the workers."** Today `app` barely touches the pool
  (delegate + telemetry). Target: `app` owns the pool as its *substance* — but **behind
  the `WorkerPool` interface** (keep the testability the port buys; my caveat in the
  review). "Contain structurally, not couple to a concrete pool." No `app` unit test
  should need a real opencode.
- **B — "the App does nothing."** `startTurn`/`turnObserved`/`atCapacity` (app.go:297-317)
  are thin telemetry shims. Move telemetry to a **decorator** around the `WorkerPool`/`App`
  boundary (a `telemetryPool WorkerPool` wrapper, or an OTel middleware in `transport`), so
  `app.Chat` reads as orchestration, not `span.End()` plumbing.
- **E — "a worker pool should be just a pool; the worker is a separate thing that
  implements the work."** The 2718-LOC `workerpool` package (`pool.go` + `worker.go` +
  `opencode.go` + `authproxy.go` + `uid.go` + `orphan_reaper.go`) splits into `workerpool/`
  (pool.go, orphan_reaper.go), `worker/` (worker.go), `worker/opencode/` (opencode.go,
  authproxy.go), and `runner/` (uid.go + the setuid/chown/spawn mechanics). **H2's
  panic-guard fixes fold into this split** — each goroutine gets `clog.Go`/`HandlePanic` as
  its package is reshaped (see §10).

### 2a. Library-grade boundaries (Alex's standard — this is the real bar)

> *"Everything should be built like a library that, when you're using it, you don't have to
> think about how it works. You don't dig through tangled panic handling, channel
> management, and error stuff inside your app function."*

The reference shapes: **`aigateway/app/app.go`** (Options + interface ports + a
`pipeline` of interceptors) and **cuvva `lib/workerpool`** (a pool you init at boot and
just *use*). Three concrete rules, enforced in review:

**Rule 1 — transport is only handlers.** `transport/` does decode → delegate → stream.
Auth (`requireInternalSecret`), panic (`Recover`), and error-logging (`Telemetry`) are
**already** middleware (verified: router.go:52/84/77). The one gap: body-read + JSON
decode + validation sit *in* `chatHandler` today (handlers.go:162-193). Extract a generic
`decode[T](w, r, max) (T, ok)` helper (read + `MaxBytesReader` + unmarshal + validate +
herr-on-fail) so the handler collapses to:

```go
func runHandler(a *app.App, max int64) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        req, ok := decode[RunRequest](w, r, max)   // parse+validate+herr, all here
        if !ok { return }
        if err := a.Run(r.Context(), req, newNDJSONStream(w)); err != nil {
            herr.WriteHTTP(w, err)                   // pre-stream failures only
        }
    }
}
```

**Rule 2 — the App is pure delegation, Options-built, telemetry as an interceptor.** Mirror
`aigateway/app`: interface-typed ports, `WithX` options, `New(opts...)`. Crucially,
**delete the hand-rolled telemetry methods** `startTurn`/`turnObserved`/`atCapacity`
(app.go:297-317) and the telemetry calls sprinkled through `Chat` — telemetry becomes a
**decorator/interceptor** (an `App`-level middleware, or a `telemetryPool` wrapper around
the `WorkerPool` port), exactly like `pipeline.Trace` in aigateway. This is review **B**
resolved structurally: `App.Run` reads as orchestration, zero `span.End()` plumbing.

**Rule 3 — the pool is a library with clean RPC-style verbs; all the machinery hides
inside it.** Today `app.Chat` (app.go:150-262) hand-manages the SSE goroutine, `errCh`,
`cancelStream`, the post-then-drain ordering, and the panic sentinel — ~110 lines of
channel/panic choreography **in the app layer**. That all moves **down** behind two clean
intents (names TBD — your list: birth/genesis vs wake/continue):

```go
// app/ports.go  — the App expresses INTENT; the pool owns the mechanism.
type WorkerPool interface {
    // Genesis: first message of a conversation — create/spawn the worker.
    StartRun(ctx context.Context, req RunRequest, out OutputStream) (Result, error)
    // Resuscitate: subsequent message — reuse the warm worker (or re-spawn if reaped).
    ContinueRun(ctx context.Context, req RunRequest, out OutputStream) (Result, error)
}
```

`StartRun`/`ContinueRun` mirror the TS `createConversation`/`continueConversation` split
(§S2 D) and read like a library call. Inside the pool/worker, hidden: acquire-or-spawn,
`Claim`, `PostMessage`, the streaming goroutine + `errCh` + drain, the panic guards, the
finalize. `app.Run` becomes a two-line router that picks the verb by
`req.IsNewConversation` and returns — no channels, no `defer cancelStream()`, no sentinel.
**The app should never make me untangle the pool to see why a worker did something.**

---

## 3. The runner seam — secure (gVisor) vs local, made unmissable (review L)

Today the isolation posture is a **bool threaded through spawn**:
`cfg.UnsafeDevDisableIsolation` → `workerpool.Options.DisableUIDIsolation` →
`workerSysProcAttr(uid, disableIsolation)` (worker.go:488) + `maybeChown`/`maybeLchown`
(worker.go:237-251) + the setuid `Credential` in `spawnOpenCode` (worker.go:521). The
security-critical choice is smuggled through five call sites as a negated flag.

**Target:** a first-class `Runner` interface selected **once**, visibly, at the
composition root.

```go
// runner/runner.go
type Runner interface {
    // Spawn creates an isolated worker process for a conversation and returns the
    // handle the worker/ layer drives. Isolation posture is the implementation's
    // whole identity.
    Spawn(ctx context.Context, spec Spec) (Handle, error)
}
```

Two implementations, each a package so the file tree tells the truth:

- **`runner/sandboxed`** (prod): per-conversation setuid UID + `chown` 0700/0600 + empty
  supplementary groups + `Setpgid` + egress forward-proxy. Assumes the pod runs under
  gVisor (`runtimeClass: gvisor` in the chart) — the runtime sandbox and the in-process
  UID sandbox are the *same posture* and now live together. Requires
  CAP_SETUID/SETGID/CHOWN.
- **`runner/local`** (dev): plain subprocess as the manager's own unprivileged user —
  `Setpgid` only, no `Credential`, no `chown` (today's `DisableIsolation` branch). Refuses
  to load in any non-local `ENVIRONMENT` exactly as `LoadConfig` does today
  (config.go:220).

Composition root (`cmd/root.go`) picks it **on one visible line**:

```go
run := runner.Sandboxed(...)          // default
if cfg.UnsafeDevDisableIsolation {     // allowlist-gated in LoadConfig, unchanged
    run = runner.Local(cfg.Environment) // SECOND guard: see below
}
pool, _ := workerpool.New(ctx, workerpool.Options{ Runner: run, ... })
```

**Belt-and-suspenders (Alex): `runner.Local` can NEVER run in prod.** On top of
`LoadConfig`'s allowlist refusal (config.go:220), `runner.Local`'s own constructor
re-checks `environmentPermitsUnsafeDev(env)` and **panics at construction** in any
non-local environment. Two independent gates now guard the un-isolated path: config load
*and* runner construction. A future refactor that accidentally drops the config check
still can't boot an un-sandboxed worker in prod.

`workerpool`/`worker` stop taking `DisableUIDIsolation`; they take a `Runner`. The five
negated-flag call sites collapse into two `Runner` methods. `maybeChown`/`maybeLchown`
become `sandboxed`'s real `chown` and `local`'s no-op — no `if disableIsolation` left in
the hot path.

> **Honesty note to preserve accuracy:** gVisor is applied at the *container runtime*
> (runsc via `runtimeClass`), not inside this Go process — the Go code never calls gVisor.
> So `runner/sandboxed` is named for the *posture it assumes and enforces in-process*
> (setuid + chown + egress under an assumed gVisor pod), and the review's aspirational
> "`local` = in-memory goroutine" is **not literal**: opencode is a separate binary, so
> `local` is still a subprocess, just an un-isolated one. A true goroutine runner would
> need a Go-native fake agent (worth it later for fast `app` tests; out of scope for the
> isolation split). The plan keeps the two runners honest about what they actually do.

---

## 4. Generic job vocabulary (review D) — decouple from LLM/chat

The service is a generic **streaming-job runner** (start a sandboxed job, stream partials,
heartbeat, deliver one final result) that happens to run an LLM. Rename the ports for the
*shape of the work*; LLM specifics ride the payload.

| Today | Target | Where |
|---|---|---|
| `App.Chat` | `App.Run` | app.go |
| `ChatRequest` | `RunRequest` (payload: `Prompt/System/Model/GitHub`) | app.go |
| `ChatSink` | `OutputStream` | app/ports.go, transport/sink.go |
| `Worker.StreamEvents(sink ChatSink)` | `Worker.Stream(out OutputStream)` | app/ports.go, worker.go |
| `TurnResult` | `Result` | app/ports.go |
| `TurnFinalizer.Finalize` | `ResultSink.Deliver` | app/ports.go, controlplane |
| `telemetry.StartTurn` | `telemetry.StartRun` | internal/telemetry |
| endpoint `POST /chat` | `POST /run` (keep `/chat` alias one release for rollback) | transport/router.go |

`conversationID` stays (it is the real aggregate key), `turnID` stays (idempotency key).
"turn" as a *word* in Go comments/types → "run"/"job". The wire frames become
`kind`-tagged (`partial`/`tool`/`heartbeat`/`final`/`error`) rather than `langy.token`
etc. — the TS side already reads a discriminated union, so this is a rename + a
compatibility shim for one release.

---

## 5. GitHub as a gateable capability (review F)

Today GitHub is baked in: `buildWorkerEnv` conditionally injects `GH_TOKEN`/`GITHUB_LOGIN`
(worker.go:418-423), `HasGithubAuth` folds into `domain.SignatureOf`, and the whole PR
flow lives in TS `runTurn`.

**Target:** `worker/capability/github` — a `Capability` the worker composes **only when
enabled**. The gate is at the seam: not-enabled ⇒ the credential is never minted and never
injected, so the sandbox *cannot reach GitHub* (strictly stronger than the denylist-env
posture, worker.go:178, which the code itself flags as non-exhaustive).

```go
// worker/capability/capability.go
type Capability interface {
    Name() string
    // Env contributes the capability's env vars ONLY when enabled for this spec.
    Env(spec Spec) []string
}
```

`buildWorkerEnv` stops special-casing GitHub; it folds in `spec.Capabilities`. Adding a
future capability (e.g. a Jira token) is a new package under `capability/`, not an edit to
the env builder. The PR-flow logic itself (auth-needed detection, PR-card enrichment,
permit accounting) is the **#24 GitHub-flow rewrite** — this plan only builds the *seam*
it will land in.

---

## 6. Frame contract, accumulator, stale comments (review M2, M3, L)

- **M2 — one decode path.** After S3 removes the TS `parseAgentLine`, delete the parallel
  `frameEnvelope` in `app/turn_accumulator.go` and have the accumulator reuse the
  producer's `OutputFrame` structs from `worker/opencode` (or `domain`). One producer, one
  decoder.
- **M3 — scrub stale TS-coupled comments.** `opencode.go:433-434` ("the control plane's
  **runTurn** peels these off…") and `opencode.go:465` ("mirrors … **langy-turn.processor.ts**
  exactly") name TS files S3 deletes. Rewrite to describe the Go envelope. `config.go`
  package doc lines 26-28 ("no idempotency yet … A turn that was mid-flight when the pod
  died is lost") is contradicted by the finalizer + `turnID` idempotency + ADR-048 handoff —
  rewrite to today's reality.
- **L1 — delete `domain.Credentials.Complete()`** (credentials.go:56, no non-test callers;
  `Spawnable()` replaced it) + its test.
- **L2 — move `extractHandoffToken`** (opencode.go:409, test-only) into `_test.go`.
- **L3/L4 — leave as flagged** (inherent `getFreePort` race is mitigated; `Credentials`
  double-duty as DTO+value-object is pragmatic). Document, don't churn.

---

## 7. Telemetry: collapse to one surface = `pkg/otelsetup` (SETTLED with Alex)

Decisions locked: **delete `langytracebridge`** (we have OTel in Go via `pkg/otelsetup`
already — no need for a bespoke second span processor), and **pull metrics into
`pkg/otelsetup`** so there is one telemetry setup, not several. Prod confirmed it does
**not** set `DebugCollectorEndpoint`, so today's metrics are genuinely dark (H1 is real,
not hypothetical).

Both bespoke surfaces go; **we keep full spans + logs + metrics, done properly** — the goal
isn't less telemetry, it's *one clean provider setup* plus *ergonomic instruments*.

**Concrete moves:**

- **Delete `langytracebridge/`** (152 LOC, ADR-044 self-observability tee). Removes the
  extra span processor, `deps.go:51` (`Install`), `Deps.InternalTeeShutdown`, the
  `serve.go:55` closer, and the `LangyInternalOTLP*` config fields. (Retires ADR-044 part 4
  — accepted.)
- **Delete the bespoke provider wiring** in `services/langyagent/telemetry`. It stops
  installing/holding any provider.
- **One provider setup = `pkg/otelsetup`**, giving all three signals: TracerProvider
  (already unconditional), **MeterProvider wired unconditionally** (the H1 fix — same path
  as traces, not gated behind `installDebugSignals` / `DebugCollectorEndpoint`,
  otelsetup.go:366), and the LoggerProvider. Prod does not set `DebugCollectorEndpoint`, so
  today's metrics are genuinely dark — this lights them up.

**Ergonomics (Alex's bar): define the instruments nicely once, then calling them is
completely out of the way — "a worker *has* metrics."**

- Instruments defined in one place (`internal/telemetry`, renamed off the "telemetry"
  collision per M4 — e.g. `metrics`), reading `pkg/otelsetup`'s global providers.
- They ride as a **small injected handle** on the things that emit them, so call sites are
  clean one-liners with zero provider plumbing:
  - **worker/pool** compose a `metrics` handle → `w.metrics.SpawnObserved(...)`,
    `w.metrics.ReadinessObserved(...)`. It *comes with the worker*; instrumenting a code
    path is one ambient call, never `otel.Meter(...).Int64Counter(...)` at the site.
  - **app-level cross-cutting** (turn duration, outcome) stays an **interceptor** (§2a
    Rule 2 / review B), not hand-rolled `span.End()` methods on the App.

After: exactly **two** OTel surfaces total — the manager's own telemetry (traces + logs +
now-wired metrics, all via `pkg/otelsetup`, instruments ambient on worker/pool/app) and the
per-worker opencode plugin (customer-facing, in the subprocess). One setup, one instrument
definition, invisible call sites.

---

## 8. Embed assets; drop entrypoint seeding (review G)

Today `entrypoint.sh` copies `AGENTS.md.template` + `skills/` from `/opt/langy-templates`
onto the `/workspace` emptyDir at pod boot; the pool reads `AGENTS.md` off disk at
`Pool.New`, and `setupWorkerHome` symlinks `${WorkspaceRoot}/skills` into each worker home
(worker.go:352-373).

**Target (embed is settled):** `//go:embed assets/*` into the binary; write per-worker
files from the embedded FS at spawn. Removes `entrypoint.sh`'s seeding step, the
`/opt/langy-templates` image layer, the `LANGY_WORKSPACE_ROOT` config field, and the
"unreadable AGENTS.md at startup" failure mode (worker.go:349-351). The per-worker symlink
becomes a per-worker *write* from the embedded FS — isolation/ownership unchanged (the
runner chowns it exactly as today).

**The one wrinkle (Alex): where the embedded bytes come from at build time.** The real
skills/AGENTS live outside the Go module and are assembled in the **Dockerfile**, but
`//go:embed` can only read paths *inside* the package at compile time. Plan:

- Check in a **dev/test asset set** at `assets/` (a minimal AGENTS.md + a token skill) so
  `go build`, `go test`, and local `pnpm dev` all compile and run against real embedded
  bytes — no missing-file failure, no network.
- The **Dockerfile overlays the production `skills/` + `AGENTS.md` into `assets/` before
  `go build`** (a `COPY`/staging step), so the shipped binary embeds the real set. The
  embed directive is identical in both cases; only the *contents* of `assets/` differ
  between a local build and the image build.
- A build-time assertion (a tiny `assets_test.go` or a `go:generate` check) fails if the
  production overlay is missing in the image build, so we can't ship the dev stub by
  accident.

> Trade-off (accepted): a production skills/AGENTS change ships as an **image rebuild**, not
> a config-map swap. Given they're versioned in-repo, that's the right coupling.
> Open sub-question: exactly which Dockerfile stage does the overlay — confirm when we get
> to the build.

---

## 9. What must exist before the S3 TS deletions are safe (the G-list)

This plan is the Go half; it directly unblocks S3. Mapping review findings → S3 blockers:

| S3 blocker | Resolved by this plan's… |
|---|---|
| **G1** Redis token-buffer writes | §0 stream contract — the relay (TS) writes the buffer; worker stays Redis-free |
| **G2** liveness heartbeat | §0 — liveness = stream freshness, owned by the relay; retires the Redis key |
| **G3** progressive tool events | §0 `tool` frames already produced; relay records them (S4) |
| **G4** GitHub PR flow | §5 seam here; flow itself is #24 |
| **G5** server recovery | orthogonal — keep or drop is a product call (S3 #3) |
| **G6** 428 re-mint | re-home into the relay's acquire path; unchanged worker contract |
| **G7** drain-terminalization | §0 relay + control-plane worker drain; ADR-048 handoff is the worker-pod half |

**Branch (SETTLED with Alex): all of this lands on `feat/langy-rework` in one branch.**
Alex breaks it into smaller reviewable branches at the end. The numbered steps below are the
*build order within that branch*, not separate PRs — but the order still holds because §0
(stream contract) is what unblocks the S3 deletions.

**Build order (folds the review's reprioritised order into the rework):**

1. **§0 + §0a stream contract + auth + K** (worker-owned authenticated heartbeat frame;
   relay derives liveness). This
   alone unblocks S3-G1/G2 and retires the reconciler/sweep. **Do first.**
2. **§3 runner seam + §4 generic vocabulary** (L + D) — the structural reframe everything
   hangs on. Big, mechanical-ish, high blast-radius; one PR.
3. **§7 telemetry** (A/I/H/H1/M4) — move to `internal`, wire the meter, drop the tracebridge.
4. **§1/§2 package split** (E/J) — split `workerpool` into pool/worker/opencode/runner;
   **§10 panic guards fold in here.**
5. **§5 GitHub capability seam** (F).
6. **§8 embed assets** (G).
7. **§6 cleanup** (M2/M3/L1/L2) — some (M3/M2) land naturally with S3.

Then the TS side (separate from this plan): the thin **relay** replaces `runTurn`'s
streaming role, and S3's deletions (`runTurn`, `langy-worker-pool`, `langy-turn-recovery`,
`langy-turn-reconciler`) proceed, ending with the `reconcileAgentTurn → agentTurnLiveness`
rename.

---

## 10. Panic-guard uniformity (review H2) — folds into §1/§2

Single-replica service: a bare-`go func()` panic takes down the manager and every in-flight
conversation. Standardise on `clog.Go`/`defer clog.HandlePanic` (already used at pool.go:278,
opencode.go:173/178, app.go:207/275) for the currently-unguarded goroutines, as each moves
package in the §1 split:

| Site (today) | Moves to | Fix |
|---|---|---|
| `egress/adapter.go:114` proxy serve | `egress/` | `clog.Go` (authproxy already does, authproxy.go:112) |
| `egress/adapter.go:253,:259` tunnel copy | `egress/` | `HandlePanic` in each copy goroutine |
| `opencode.go:832` heartbeat | `worker/opencode/` | `HandlePanic` (untrusted marshal in a hot loop) |
| `handlers.go:141` detached warm | `transport/` | `clog.Go` |
| `pool.go:903` `go w.egress.Close()` | `workerpool/` | `clog.Go` |

---

## 11. File-by-file change ledger

**Moved (git mv, package rename):**
- `adapters/httpapi/*` → `transport/*`
- `adapters/workerpool/pool.go`, `orphan_reaper.go` → `workerpool/`
- `adapters/workerpool/worker.go` → `worker/` (minus spawn/isolation)
- `adapters/workerpool/opencode.go`, `authproxy.go` → `worker/opencode/`
- `adapters/workerpool/uid.go` + spawn/setuid/chown from `worker.go` → `runner/sandboxed/` + `runner/local/`
- `adapters/egress/*` → `egress/`
- `adapters/controlplane/*` → `controlplane/`
- `telemetry/*` → `internal/telemetry/` (renamed `metrics`)

**Changed:**
- `app/app.go`, `app/ports.go` — generic vocab (`Run`/`RunRequest`/`OutputStream`/`Result`); telemetry → decorator; `App` owns pool behind interface.
- `app/turn_accumulator.go` — reuse producer frame structs (M2, post-S3).
- `cmd/root.go` — pick `Runner` on one line; drop `DisableUIDIsolation` threading; drop tracebridge wiring.
- `deps.go` — drop `InternalTeeShutdown`; telemetry from `internal/telemetry`.
- `serve.go` — drop `langy-internal-tee` closer.
- `config.go` — drop `LangyInternalOTLP*`, `LANGY_WORKSPACE_ROOT` (embed); rewrite stale package doc (M3).
- `worker/opencode/opencode.go` — `OutputFrame` envelope + `heartbeat` frame; scrub TS-coupled comments (M3); move `extractHandoffToken` to `_test.go` (L2); panic-guard heartbeat (H2).
- `domain/credentials.go` — delete `Complete()` (L1).
- Chart: `runtimeClass` note for `runner/sandboxed`; drop `/opt/langy-templates` layer + `entrypoint.sh` seeding (G).

**Deleted:**
- `langytracebridge/` (H) — *pending the §7 ADR-044 decision*.
- `entrypoint.sh` asset-seeding (G).
- `adapters/` grouping dir (emptied by the moves).

---

## 12. Decisions

**Settled with Alex:**
- **Frame auth (§0a):** per-frame HMAC with a `runToken`; identity = user + conversation +
  project; addressing requires the full triple; **no sequence** — cross-turn replay closed
  by `turnId`-checked, intra-turn by a per-turn **`frameNonce` seen-set** ("do the frame
  once"); `runToken` durable + projection-excluded.
- **Relay (§0b):** a **proper Hono service** in TS that **listens** for **pushed** worker
  frames (push confirmed). The durable buffer is **already a Redis Stream**
  (`langyTokenBuffer.ts`) — a rewire, not a rebuild: writer moves from `runTurn` to the
  relay, add HMAC-verify + `frameNonce` dedup, move liveness onto the stream (retire
  `langy:hb`). Relay instances stateless; no separate bus in v1.
- **Transport (§0b/§2a):** RPC-style POSTs (`create_worker`/`revive_worker`/
  `continue_worker`) with structured payloads; validation + body-parse + herr reused from
  shared middleware; thin handlers. **`/chat` hard-cut** to the RPC verbs (no rollback
  alias — only our own control plane calls it).
- **Telemetry (§7):** delete BOTH `langytracebridge` and the bespoke provider wiring; keep
  spans + logs + metrics via one `pkg/otelsetup` (MeterProvider wired unconditionally —
  metrics are dark today); instruments defined once, **ambient on worker/pool** ("a worker
  has metrics"), app cross-cutting via interceptor.
- **`runner/local` (§3):** pragmatic plain-subprocess (no setuid), **plus a second hard
  prod guard** in the `Local` constructor.
- **Embed (§8):** `//go:embed assets/*`; dev/test asset set checked in, Dockerfile overlays
  the real set before `go build`.
- **Branch (§9):** everything on `feat/langy-rework`; Alex splits later.
- **Library-grade standard (§2a):** transport = thin handlers (`decode[T]` helper); App =
  Options-built pure delegation, telemetry as an **interceptor** (delete the hand-rolled
  `startTurn`/`turnObserved`/`atCapacity`); pool = library with clean two-intent verbs, all
  channel/panic/stream machinery hidden inside it.
- **Working style (Alex):** full file rewrites are fine — don't preserve messy shape for
  its own sake. **Exception: security files must keep the same tests passing** (isolation,
  egress, HMAC-verify, `runToken` minting, credential handling). Rewrite the impl; the
  security tests are the invariant that proves the rewrite didn't weaken anything.

**Still open (cosmetic only):**
1. **App method names** — `StartRun`/`ContinueRun` internally (the endpoints are already
   `create_worker`/`continue_worker`). Pure naming.

_(Push, buffer-is-already-a-stream, and `/chat` hard-cut all now settled — see above.)_

**Future / end-of-project (parked, do NOT touch now):**
- **Credential crucible (Alex).** Replace env-var credential injection
  (`buildWorkerEnv` → `OPENAI_API_KEY`/`LANGWATCH_API_KEY`/`GH_TOKEN` in the subprocess
  env, readable via `/proc/self/environ` by a model-driven shell) with a **crucible**: a
  just-in-time credential broker or short-lived tokens never resident in env, so a
  prompt-injected worker cannot `env | grep` its way to a secret. Strictly stronger than
  today's denylist posture (worker.go:178, self-admittedly non-exhaustive). Design at the
  very end — it interacts with the runner seam (§3), the GitHub capability (§5), and the
  `runToken` provisioning (§0a), all of which currently ride the env.
```
