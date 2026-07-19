# Langy worker (`services/langyagent`) — Go-standards review

Scope: **`services/langyagent/` only** (the Go "manager" that owns the per-conversation
`opencode` subprocess pool). This is a read-only review — no code was changed. All
line numbers are as of branch `feat/langy-rework`.

> TL;DR — This is a **well-built, idiomatic Go service**: clean hexagonal layering,
> disciplined resource rollback, thoughtful security model, good test coverage (19
> test files). It is **not** a mess architecturally. What *reads* as a mess is three
> things, all fixable without restructuring: (1) **four** different "OTel" surfaces
> with overlapping names — but **no dependency-version conflict**; (2) the **manager's
> operational metrics are effectively dark in production** (the meter is a no-op unless
> a debug collector is configured); (3) the same wire contract (the `langy.*` ndjson
> frames) is **parsed in three places across two languages**, and the Go code carries
> **stale comments naming the TypeScript files** that S3 is about to delete.

---

## 1. Component & package map

```
cmd/service (mono-binary)  ──"langyagent"──►  services/langyagent/cmd.Root
                                                    │  LoadConfig → NewDeps → wire → Serve
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ services/langyagent  (module github.com/langwatch/langwatch — ROOT go.mod)   │
│                                                                               │
│  config.go / deps.go / serve.go        composition root + pkg/lifecycle       │
│                                                                               │
│  domain/            279 LOC   Credentials, CredentialSignature, errors,       │
│                               IsValidConversationID, egress host normalise    │
│  app/               544 LOC   App orchestrator + ports.go (WorkerPool,         │
│                               Worker, ChatSink, TurnFinalizer) + accumulator  │
│  adapters/                                                                     │
│    httpapi/         492 LOC   DRIVING adapter: net/http mux, /chat /warm       │
│                               /worker/probe /health*, ndjson sink             │
│    workerpool/     2718 LOC   DRIVEN adapter: pool, worker, opencode client,   │
│                               authproxy, uid, orphan_reaper  ◄── the bulk      │
│    egress/          995 LOC   DRIVEN adapter: per-worker forward proxy (ADR-043)│
│    controlplane/    227 LOC   DRIVEN adapters: Finalizer + Revoker (outbound)  │
│  telemetry/         181 LOC   manager's own spans + 8 metric instruments       │
│  langytracebridge/  152 LOC   self-observability span tee (ADR-044)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

Layering is **correct hexagonal**: `app` declares ports (`app/ports.go`), `domain` is
pure, driven adapters implement the ports, the driving adapter (`httpapi`) only does
auth + decode + delegate. Compile-time port checks (`var _ app.WorkerPool = (*Pool)(nil)`,
`var _ app.Worker = (*Worker)(nil)`, `var _ app.ChatSink = (*ndjsonSink)(nil)`) are
present. This mirrors `nlpgo`/`aigateway`, which is the intended house style.

---

## 2. The app ↔ worker contract (how the TS control plane connects to the Go worker)

Two directions, **one shared secret** in both (`LANGY_INTERNAL_SECRET`, Bearer). No
second credential is ever introduced — a deliberate, good decision (see
`controlplane/revoker.go` package doc).

```
        CONTROL PLANE (TS)                         GO WORKER (langyagent)          OPENCODE SUBPROCESS
        ─────────────────                          ──────────────────────          (per conversation)
                                    inbound: Bearer LANGY_INTERNAL_SECRET
 langyWorker.ts::probeLangyWorker ──POST /worker/probe──► probeHandler ──► HasLiveWorker(sig)
   {conversationId,model,             {alive:bool}         (READ-only; spawns nothing;
    hasGithubAuth,egressAllowlist}                          signature via domain.SignatureOf)
                                                                                        
 langyWorker.ts::warmLangyWorker ──POST /warm (202)──────► warmHandler ──► App.Warm ──► Pool.Acquire ──► spawn opencode
   {conversationId,credentials,        (fire&forget)        (detached 90s; idempotent;   (fork, setuid UID,
    modelOverride}                                          never Claims/PostMessages)    authproxy, egress proxy,
                                                                                          waitForReadiness, createSession)
 langy-turn.processor.ts (turn) ──POST /chat─────────────► chatHandler ──► App.Chat:
   {conversationId,prompt,system,      application/x-ndjson    Acquire → Claim → PostMessage ──POST /session/{id}/prompt_async──►
    credentials,modelOverride,         stream ◄────────────    (streamSessionEvents)     ◄──GET /event (SSE)──────────────────
    resumeToken,turnId,projectId}                             emits verbatim opencode lines
                                                              + langy.token / langy.tool /
                                                              langy.progress frames (multiplexed)
                                                              busy → 409 herr; else 200 stream

                                    outbound: Bearer LANGY_INTERNAL_SECRET
 langy-internal.ts ingest ◄──POST /api/internal/langy/turn/{turnId}/result── controlplane.Finalizer
   (idempotent on turnId)             {projectId,conversationId,status,text,toolCalls}   (durable final, 3 retries,
                                                                                          fire&forget, detached ctx)
 langy-internal.ts revoke ◄──POST /api/internal/langy/credentials/revoke──── controlplane.Revoker
   (404 == success)                   {apiKeyId}                                          (best-effort, no retry,
                                                                                          on worker death)
```

### Endpoint inventory (served by the worker — `httpapi/router.go`)

| Method+Path | Handler | Auth | Request | Response |
|---|---|---|---|---|
| `GET /healthz` `/readyz` `/startupz` | `pkg/health` | none | — | k8s probes |
| `GET /health` | `healthAlias` | none | — | `ok (N/MAX workers)` text (legacy alias, still used by `langy.ts::isAgentHealthy` + chart) |
| `POST /chat` | `chatHandler` | Bearer | `chatRequest` (handlers.go:29) | `application/x-ndjson` stream, or herr (400/401/409/413) |
| `POST /warm` | `warmHandler` | Bearer | `warmRequest` (handlers.go:94) | always `202` |
| `POST /worker/probe` | `probeHandler` | Bearer | `probeRequest` (probe.go:24) | `{alive:bool}` |

Middleware chain (outermost→in): `RequestID → Recover → Tracing → Telemetry → Version`
(router.go:73-86). `Tracing` is placed **outside** `Telemetry` on purpose so the
control plane's `traceparent` is adopted as the span parent — good, and documented.

### The credential handoff (worth calling out as the cleverest part)

- **Probe-before-mint**: control plane asks `/worker/probe` whether a live worker with
  matching capabilities exists. `true` ⇒ *don't mint a session key* (the running worker
  already holds one in its subprocess env). The signature is computable **without** a
  key (`domain.SignatureOf` reads only model / GitHub-presence / egress allow-list),
  which is the whole reason probe-then-mint is possible.
- The probe race (worker dies between probe and `/chat`) is resolved by `Pool.Acquire`
  refusing a keyless spawn with `ErrCredentialsRequired` (pool.go:438) → control plane
  mints once and retries. Advisory-read + authoritative-write is the right split.
- Credentials **never** persist: injected into the subprocess env at spawn
  (`buildWorkerEnv`, worker.go:392), die with the process. `apiKeyID`+`endpoint` are
  recorded so the key can be **revoked** on death — revoke-only, never mint.

This part is genuinely good and the contract is coherent. The seams that *are* messy
are below.

---

## 3. The "3 versions of OTel" — what's actually going on

There is **no OTel dependency-version conflict.** Every stable-core `go.opentelemetry.io/otel*`
module is pinned to **v1.43.0** uniformly across the root module *and* `sdk-go` /
examples / e2e. What you're seeing is **(a) the OTel ecosystem's independent module
versioning**, and **(b) four different telemetry code-paths that touch this one service**
with overlapping names.

### (a) The version families (all in the one ROOT `go.mod`; these are NOT competing versions of the same thing)

```
 stable core      v1.43.0   otel, otel/metric, otel/trace, otel/sdk, otel/sdk/metric,
                            exporters/otlp/otlptrace(+http), otlpmetric/otlpmetrichttp
 experimental log v0.19.0   otel/log, otel/sdk/log, exporters/otlp/otlplog/otlploghttp
 contrib          v0.68.0   contrib/instrumentation/net/http/otelhttp, .../runtime
                  v0.18.0   contrib/bridges/otelzap
 collector        v1.57.0   collector/{client,component,featuregate,pdata}
                  v0.151.0   collector-contrib/pkg/ottl, .../coreinternal, pdata/pprofile
```

The `log` line is at 0.x because OTel's Go **logs API is still pre-stable** — that's
upstream, not a local mistake. The **collector / ottl** deps (v1.57 / v0.151) belong to
**`aigateway`** (its OTTL server), and the **log** deps belong to **`pkg/clog` +
`pkg/otelsetup`** — **`langyagent` itself imports only the v1.43 stable core + sdk/trace
+ otlptrace** (verified: its only direct `go.opentelemetry.io/*` imports are `otel`,
`attribute`, `codes`, `metric`, `metric/noop`, `trace`, `sdk/trace`, `otlptrace(+http)`).
So from the worker's point of view there is exactly **one** OTel version line: **1.43.0**.

### (b) The four telemetry surfaces that touch langyagent (this is the real "3 versions" feeling)

```
 ① pkg/otelsetup                     THE canonical provider install. cfg.OTel.Configure
    (deps.go:42)                     installs the global TracerProvider (unconditional)
                                     and — only via installDebugSignals — the Meter/Logger
                                     providers. Owns ForceFlushGlobal + BatchScheduledDelay.

 ② services/langyagent/telemetry     A hand-rolled facade named "telemetry" that reads the
    (deps.go:65, telemetry.New())    GLOBAL providers (otel.Meter / otel.Tracer) and defines
                                     the manager's spans (StartTurn/StartSpawn) + 8 metric
                                     instruments (spawns/kills/exits/active/at_capacity/
                                     turn_duration/spawn_duration/readiness).

 ③ services/langyagent/langytracebridge  A SECOND span exporter (otlptrace v1.43) registered
    (deps.go:51, Install())          as an extra span processor on the SAME global TP, content-
                                     stripped, teeing to a static INTERNAL LangWatch project
                                     (ADR-044 self-observability). No-op unless configured.

 ④ opencode OTel plugin              A JS OTel pipeline running INSIDE each worker subprocess.
    (worker.go:405-409)              buildWorkerEnv sets OPENCODE_ENABLE_TELEMETRY + OPENCODE_OTLP_*
                                     so the plugin exports gen_ai.* spans into the CUSTOMER's
                                     project. Versioned independently (OPENCODE_OTEL_PLUGIN_VERSION).
```

Three of these live in Go and one in a subprocess; **two are named "telemetry"/"otelsetup"
and a third is also telemetry** (`langytracebridge`). That naming collision is the whole
reason it feels like "3 versions." They actually serve four distinct purposes (global
setup / manager instruments / internal tee / customer-facing per-worker traces) and each
is individually justified.

### ⚠️ Finding: the manager's 8 operational metrics are DARK in production

`otelsetup` calls `SetTracerProvider` **unconditionally** (otelsetup.go:351) but only calls
`SetMeterProvider` **inside `installDebugSignals`**, which is **gated on
`DebugCollectorEndpoint`** (otelsetup.go:366) — described in-code as "a no-op unless a
developer opted into the local observability stack." So unless production sets the debug
collector endpoint, the global Meter is the **default no-op**, and every instrument in
`telemetry.go` (`langy.worker.spawns`, `langy.pool.at_capacity`, `langy.turn.duration`, …)
records to nothing. `telemetry.go`'s own package doc admits this (lines 11-12: "a no-op
MeterProvider until one is wired"). Traces work; **metrics don't** on the normal path.

**Action:** confirm whether prod sets `DebugCollectorEndpoint`. If not, either wire a
production OTLP MeterProvider (unconditional, like traces) or stop presenting these
instruments as operational signal. Right now the code *looks* observable and isn't.

---

## 4. Go-standards findings (ranked)

### High / real risk

**H1 — Operational metrics are no-ops in prod.** See §3. Severity depends on whether
`DebugCollectorEndpoint` is set in prod; if it isn't, the entire metric surface is dead
weight. `telemetry.go` is otherwise clean (nil-safe, fallback-to-noop per instrument).

**H2 — Goroutine panic-guard is applied inconsistently, and the gaps are on hot paths.**
The workerpool is disciplined — it uses `clog.Go` / `defer clog.HandlePanic` almost
everywhere (pool.go:278,712,831,888,897; opencode.go:173,178; app.go:207,275). But these
goroutines are **bare `go func()` with no recover**:
- `egress/adapter.go:114` — the per-worker forward-proxy **serve** goroutine
  (the equivalent authproxy serve *is* guarded via `clog.Go`, authproxy.go:112).
- `egress/adapter.go:253` and `:259` — the two **tunnel copy** goroutines.
- `opencode.go:832` — the **heartbeat** goroutine (`langy.progress` emitter).
- `handlers.go:141` — the detached **warm** goroutine.
- `pool.go:903` — `go w.egress.Close()`.

This service is **single-replica** (config.go package doc), so a panic in any of these
takes down the manager and **every** in-flight conversation with it. A panic in the
egress tunnel splice (untrusted network bytes) or the heartbeat marshal is exactly the
kind of thing that should never escape a goroutine here. **Standardize on `clog.Go` /
`clog.HandlePanic` for all spawned goroutines** — the pattern already exists and is used
next door.

### Medium

**M2 — The same wire contract is decoded in three places across two languages.** The
`langy.token` / `langy.tool` / `langy.progress` frame lifecycle is:
1. **produced** in Go — `opencode.go` `framesFor`/`textDeltaFromEvent`/`toolStartFrame`/
   `toolEndFrame` + the `toolCallTracker` (~300 LOC, opencode.go:431-762);
2. **re-parsed** in Go — `app/turn_accumulator.go` `accumulatingSink.observe` decodes the
   same frames to build the durable final;
3. **re-parsed** in TS — `langy-turn.processor.ts::parseAgentLine` (confirmed consumer).

opencode.go's comments even say the Go mapping "mirrors the control plane's `parseAgentLine`
(langy-turn.processor.ts) **exactly**" (opencode.go:465) — i.e. two hand-kept copies of one
contract in different languages, plus a third partial copy in the accumulator. This is a
drift hazard. S3 deletes the TS copy (#3), which *reduces* the problem to Go-only, but
until then any change to the frame shape must be made in lock-step in three spots. Consider
a single shared frame-shape definition and one decode path once S3 lands.

**M3 — Stale comments couple the Go service to TypeScript module names S3 is deleting.**
`opencode.go:433-434` ("the control plane's **runTurn** peels these off…") and
`opencode.go:465` ("mirrors the control plane's parseAgentLine (**langy-turn.processor.ts**)")
name TS files that the S3 step (`runTurn`, `langy-turn.processor`) is scheduled to delete.
After S3 these comments are actively wrong. `config.go`'s package doc is similarly dated:
lines 26-28 still say "no idempotency yet — event-sourced recovery is a later PR … A turn
that was mid-flight when the pod died is lost," which the finalizer + `turnId` idempotency +
ADR-048 handoff now partly contradict.

**M4 — Naming collision on "telemetry".** `pkg/otelsetup` (setup), `services/langyagent/telemetry`
(instruments facade), and `langytracebridge` (span tee) are three telemetry things, two
sharing the word. Rename `telemetry` → `metrics` or `instruments`, and add a single doc
comment (or the diagram in §3(b)) enumerating the four OTel surfaces. Pure clarity — no
behavior change.

### Low / polish

- **L1 — Dead code:** `domain.Credentials.Complete()` (credentials.go:56) has **no
  non-test callers** — `Spawnable()` replaced it. Delete it (and its test) or wire it
  back.
- **L2 — Test-only helper in a production file:** `extractHandoffToken` (opencode.go:409)
  is only referenced by its own doc comment and tests ("this exists only so tests … can
  assert the frame shape"). Move it to `_test.go` or delete if the handoff-token assertion
  moved elsewhere.
- **L3 — `getFreePort` close-then-rebind race** (opencode.go:127) is acknowledged and
  mitigated (8-try reroll to avoid internal==external, opencode.go:631-642), but the
  fundamental race with opencode binding the port remains. Fine to keep; just flagging
  it's inherent, not fixed.
- **L4 — `Credentials` struct as a domain value object carries omitempty JSON tags**
  (it's both the wire DTO and the domain type). Minor DDD smell — the transport shape and
  the domain value are the same struct — but pragmatic and low-risk here.

---

## 5. What is genuinely good (so it isn't lost in the critique)

- **Resource rollback in `spawnInner`** (pool.go:532-745): stacked `defer … if !success`
  undos unwind UID reservation, egress proxy, home dir (with plaintext creds), listener,
  and the opencode process in reverse order on any early return **or panic**, and flip to
  no-ops once healthy. Textbook.
- **Replacement-race correctness** (`onWorkerExit`, pool.go:762): registry deletes guarded
  by `*exec.Cmd` identity, UID release guarded by conversation id, home wipe gated on
  "still own the slot AND no spawn in flight," slow `RemoveAll` moved off the lock via an
  in-lock rename to a tombstone. This is careful, hard-won concurrency code.
- **Security model**: per-worker setuid UID sandbox (`workerSysProcAttr`), 0700/0600 +
  chown before any secret lands, per-worker authproxy with constant-time bearer compare
  **plus** a distinct `OPENCODE_SERVER_PASSWORD`, a **fail-closed readiness probe** that
  refuses to start a worker whose control API doesn't enforce auth
  (`requireOpenCodeAuthEnforced`, opencode.go:263), a sensitive-env denylist with an
  honestly-documented suffix-gap, process-group kill so reparented `gh`/`git` children
  can't outlive a worker holding tokens, and the ADR-043 egress forward-proxy. The
  `UnsafeDevDisableIsolation` flag is allowlist-gated to local-like `ENVIRONMENT` and
  fails closed everywhere else.
- **Graceful shutdown** (`serve.go`): correct reverse-order lifecycle, ADR-048 handoff +
  early-flush with honest "SIGKILL is uncatchable" caveats, deadline math validated at
  config load.
- **Streaming hot path**: single typed `sseEvent` decode reused per line, `scanner.Bytes()`
  with a reused scratch buffer (one alloc/turn), write-mutex so the heartbeat can't
  interleave mid-line. Good perf hygiene.
- **Config**: `pkg/config` env hydrate + validator tags, fail-fast on missing secret,
  sensible defaults, self-consistency checks.

---

## 6. Prioritized recommendations

1. **(H1) Decide the metrics story.** Confirm whether prod sets `DebugCollectorEndpoint`.
   If not, wire a real MeterProvider unconditionally (traces already are) — otherwise the
   8 instruments are theater. *~1 line in otelsetup + an ops confirmation.*
2. **(H2) Make goroutine panic-guarding uniform.** Wrap the egress serve/tunnel goroutines,
   the opencode heartbeat, and the warm goroutine with `clog.Go`/`clog.HandlePanic`. On a
   single-replica service this is the difference between one dropped tunnel and a
   whole-pod outage. *Mechanical, ~6 sites.*
3. **(M4) Rename `telemetry` → `metrics`/`instruments` and document the four OTel
   surfaces** in one place (drop §3(b) as a package doc). Kills the "3 versions" confusion
   at the source. *Rename + comment.*
4. **(M3) Scrub the stale TS-coupled comments** in `opencode.go` and the dated `config.go`
   package doc — ideally as part of S3, since S3 deletes the very files they name.
5. **(M2) After S3 removes the TS parser, collapse the frame contract** to one Go decode
   path (the accumulator can reuse the producer's frame structs rather than a parallel
   `frameEnvelope`).
6. **(L1/L2) Delete `Credentials.Complete()`; move/remove `extractHandoffToken`.**

None of these are structural. The service is fundamentally sound; the work is naming,
observability wiring, panic-guard uniformity, and shedding transitional TS coupling.

---

## S3 — TypeScript deletion & migration plan

Goal: make the Go worker the **sole** turn driver and delete the TS orchestration. This
is **plan only — nothing is deleted here.**

> **Headline finding: the TS orchestration is NOT "now-dead" — it is still load-bearing.**
> The Go worker touches **no Redis, no liveness key, and no token buffer** (verified: zero
> `redis`/`liveness`/`heartbeat`/`appendChunk` references under `services/langyagent`). Today
> the **only** thing that writes the Redis token buffer the browser reads via
> `langy.onTurnStream`, and the **only** thing that refreshes the per-turn liveness key the
> `reconcileAgentTurn` reactor checks, is **`runTurn`** (`langy-turn.processor.ts`). Delete it
> before the Go worker replicates those, and the live stream goes dark and every healthy
> in-flight turn gets false-failed by the liveness reactor. So **almost none of these
> deletions are typecheck-trivial or runtime-safe today** — they are gated on real Go work.

### Data-flow today (why runTurn is the linchpin)

```
 browser ◄── tRPC langy.onTurnStream ──── reads Redis token buffer ◄── writes ── runTurn (langy-turn.processor.ts)
                                          reads liveness key ◄── refreshes ─────┘   │  POST {agentUrl}/chat
 reconcileAgentTurn.reactor ── checks liveness key (stale? → failTurn) ────────────┘   ▼
                                                                              Go worker /chat (ndjson stream)
                                                                              + Go finalizer → langy-internal (FINAL only)
```

The Go worker already posts the **durable final** (answer + tool calls) to langy-internal
(idempotent on turnId). What it does **not** do is anything *during* the turn that the
control plane observes: buffer writes, liveness, progressive tool events, the GitHub flow.

### Per-unit breakdown

| # | TS unit | Current responsibility | Non-test call-sites that break on deletion | Blocked on (Go work that must exist first) |
|---|---------|------------------------|--------------------------------------------|--------------------------------------------|
| 1 | **`runTurn`** (`langy-turn.processor.ts::runTurn`) | The whole turn: POST `/chat`, parse ndjson, **write Redis token buffer** (`appendChunk`/`appendTool`/`markEnd`/`markError`), **refresh liveness heartbeat**, progressive **durable tool events** (`recordToolCallStarted/Completed`), **GitHub PR flow** (auth-needed detection, progress cards, `gh pr create` link extraction, PR-card enrichment, permit reserve/reconcile/release, audit), **credentials 428 re-mint**, **server-side recovery** | `langy-turn.processor.ts` (self), `workers.ts` (via `startLangyTurnProcessor`) | **G1** buffer writes · **G2** liveness heartbeat · **G3** progressive tool events (S4) · **G4** GitHub flow · **G5** server recovery · **G6** 428 re-mint |
| 2 | **`langy-worker-pool.ts`** (`LangyWorkerPool`) | In-process concurrency bound + in-flight tracking + **`drain()` (terminalize every in-flight turn on shutdown)** | `spawnAgent.reactor.ts` (type import + `setPool`), `langy-turn.processor.ts` (`startLangyTurnProcessor`, `drain`), `pipeline.ts` (type), `workers.ts` (`new LangyWorkerPool`, `setPool`) | **G7** drain-terminalization equivalent (see gap below) + rewire `spawnAgent` to dispatch `/chat` directly |
| 3 | **`langy-turn-recovery.ts`** (`resolveServerRecovery`) | Server-side retry policy (at-capacity / unavailable backoff + status line). **Only comment-referenced** by the client policy — no client import | `langy-turn.processor.ts` only | **G5** (or an explicit decision to drop server-side retry and rely on the client recovery policy) |
| 4 | **`langy-turn-reconciler.ts`** (`reconcileLangyTurns`, `decideReconcileAction`) | Boot + interval **liveness sweep** (deploy-survival backstop: find `running` turns with lapsed heartbeat cross-tenant, fail them) | `langy-turn.processor.ts` (`startLangyTurnProcessor`) | **G2** (the sweep is meaningless until *something* refreshes the heartbeat; and note the per-turn reactor #6 is a *durable delayed job* that already survives a pod restart, so the interval sweep may be redundant post-migration — decide) |
| 5 | **`reconcileAgentTurn.reactor.ts`** → **rename** to `agentTurnLiveness.reactor.ts` | Per-turn delayed liveness timer (arms on `agent_response_started`, re-arms on `tool_call_*`, fails a stalled turn). **KEPT, renamed** | `pipelineRegistry.ts` (import + construct), `pipeline.ts` (dep field + `.withReactor` name), `langyTitleGeneration.reactor.ts` (comment only) | **G2** for it to be *correct* (else it false-fails healthy turns); the rename itself is mechanical |

### What has NO Go equivalent yet (would be LOST on a naive delete) — flag list

- **G1 — Redis token-buffer writes.** Live streaming to the browser depends entirely on
  `runTurn` writing `appendChunk`/`appendTool`/`markEnd`/`markError`. Go worker: none.
  **Hard blocker for the live UX.**
- **G2 — Liveness heartbeat.** The liveness key is refreshed only by `runTurn` (interval
  + on each `langy.progress` frame). The Go worker *emits* `langy.progress` frames on the
  `/chat` stream but nothing on the durable side writes the key. Delete `runTurn` and the
  liveness reactor (renamed or not) will false-fail every healthy turn. **Hard blocker.**
- **G3 — Progressive durable tool events.** `runTurn` records `tool_call_initiated/succeeded/failed`
  per call as they land. The Go finalizer only posts the **final** aggregate `toolCalls`.
  Interleaved per-call events are S4 and not done worker-side.
- **G4 — The entire GitHub-PR flow.** `needsGithubAuth`→`LangyGithubNotConnectedError`,
  `githubStepOf` progress cards, `recordOpenedPrs` (extract links from `gh pr create`
  stdout — not the model's prose), `fetchGithubPrDetails` enrichment, permit
  reserve/reconcile/release with the erosion-via-blip latch, and the `langy.github.pr_opened`
  audit log. **None of this exists in Go.** This is the largest single migration chunk and
  the highest-risk (permit accounting + audit correctness).
- **G5 — Server-side recovery.** `resolveServerRecovery` retries at-capacity/unavailable
  with backoff on the same open stream, gated on "produced no output." Go has nothing
  equivalent (the finalizer's 3-retry loop is for the *final POST*, a different thing).
- **G6 — Credentials 428 re-mint.** `runTurn` mints a session key once on `428` and retries.
  In self-drive this flow changes shape but must be consciously re-homed, not dropped.
- **G7 — Drain-on-shutdown terminalization.** `LangyWorkerPool.drain` fails every in-flight
  turn with `langy_worker_restarting` + releases its permit on control-plane shutdown. The
  Go worker's ADR-048 `ShutdownHandoff` is a *different* strategy (checkpoint + resume
  token), and it covers the **worker** pod, not the **control-plane** worker process. If the
  control-plane worker (which runs the spawnAgent reactor + onTurnStream relay) is what
  deploys, its drain semantics need a deliberate answer.
- **Preserved, not lost** (don't over-worry these): the **GroupQueue superseded-turn guard**
  (`spawnAgent.reactor` `foldState.CurrentTurnId !== turnId` + the reactor's `eventTurnId !==
  currentTurn` check) and the **single-use handoff take** (`langyTurnHandoff.ts`) both live in
  units that **survive** S3 — `spawnAgent.reactor` and `langyTurnHandoff` are kept (spawnAgent
  just changes from `pool.submit` to a direct `/chat` dispatch). `buildFinalAssistantParts`
  (`langy-final-parts.ts`) also **survives** — `langy-conversation.service.ts` uses it for the
  durable-final ingest; only `runTurn`'s import of it goes away.

### Safe ordering

1. **Phase G (Go, BLOCKING — bulk of the work):** worker-side G1 (buffer writes), G2
   (liveness), then G3/G4/G5/G6/G7. Until at least **G1 + G2** land, *nothing* below is
   runtime-safe. G4 is a project in itself.
2. **Phase 1 — rewire dispatch:** change `spawnAgent.reactor` to POST `/chat` directly (or
   via a thin app-layer dispatcher) instead of `LangyWorkerPool.submit`; drop the `setPool`
   late-binding. Now `runTurn`/the pool have no live caller except `workers.ts` wiring.
3. **Phase 2 — delete `runTurn` + `langy-turn.processor.ts`**, and its imports of
   `langy-turn-recovery`, `langy-turn-reconciler`, the token buffer, the handoff drain.
4. **Phase 3 — delete `langy-worker-pool.ts`, `langy-turn-recovery.ts`,
   `langy-turn-reconciler.ts`** (+ their tests). Decide #4's fate: if the per-turn *durable
   delayed* reactor #5 suffices for deploy-survival, the interval sweep is redundant; if not,
   its logic must move (e.g. into the reactor's re-arm or an ops job).
5. **Phase 4 — rename `reconcileAgentTurn.reactor.ts` → `agentTurnLiveness.reactor.ts`**:
   file, `createReconcileAgentTurnReactor` → `createAgentTurnLivenessReactor`, `reactor.name`
   `"reconcileAgentTurn"` → `"agentTurnLiveness"`, the `reconcileAgentTurnReactor` dep field in
   `pipeline.ts` (+ its `.withReactor` registration name), the `pipelineRegistry.ts` import/
   construction, the `makeJobId` prefix `langy-reconcile:` and logger name, and the comment in
   `langyTitleGeneration.reactor.ts`.
6. **Phase 5 — cleanup `workers.ts`** (remove pool construction, `startLangyTurnProcessor`,
   `setPool`, the shutdown handle) and the `pipeline.ts`/`pipelineRegistry.ts` pool wiring.

### Typecheck-safe-now vs blocked

- **Blocked on Go (not safe now):** deleting `runTurn`/`langy-turn.processor` (#1),
  `langy-worker-pool` (#2), `langy-turn-recovery` (#3), `langy-turn-reconciler` (#4). All are
  reachable from `workers.ts` and, more importantly, are the live buffer/liveness owners.
- **Mechanically safe (typecheck) but semantically gated:** the **rename** (#5). It compiles
  fine after updating the ~6 references, but the reactor only becomes *meaningful* once **G2**
  exists. **Runtime caveat:** the reactor `name` is the durable job-dedup namespace, so a
  delayed liveness job armed under `reconcileAgentTurn` before the deploy won't be matched
  under `agentTurnLiveness` after it — in-flight timers at the rename boundary fall back to
  the sweep (or nothing, if #4 is also gone). Rename in a quiet window or accept the one-turn
  gap.

---

## F — dispatch idempotency (blocks optimistic inline dispatch)

**Question: is the manager's `POST /chat` idempotent / de-duplicated on `turnId`?**

**No.** The manager keys and guards on **`conversationId`, never `turnId`.** Verified: the
only use of `turnId` anywhere in the worker is `ChatRequest.TurnID` (handlers.go:211,
app.go:84) threaded into the **durable-final POST** (`finalizeCompletedTurn`, app.go:270) —
it is the ingest's idempotency key, and it is **not** consulted for dispatch dedupe. There
is no in-flight turnId set, no turnId lease, no turnId in the `Worker` struct.

What actually happens with two `/chat` calls for the same `conversationId` + `turnId`:

- `Pool.Acquire` is keyed by `conversationId` (pool.go:393) → both calls get the **same
  worker** when the credential signature matches.
- `worker.Claim()` (app.go:180) is a **boolean in-flight mutex** (worker.go:109), not
  turnId-aware.

So:

- **Concurrent** (inline + reactor overlap): first `Claim()` wins and runs the turn; the
  second gets `Claim()==false` → `ErrConversationBusy` → **HTTP 409** (app.go:183). The turn
  runs **once** — but the 409 is *not* a benign "someone else has it" signal: today's
  `runTurn` maps a non-2xx to `LangyAgentUnavailableError{status:409}` and **terminalizes the
  turn as failed** (langy-turn.processor.ts:622), which would race and clobber the winner. So
  even the concurrent case is **not safe** with the current caller behavior.
- **Sequential** (reactor backstop fires *after* the inline turn completed and released the
  worker): `Claim()` succeeds again → the manager **posts a second prompt to opencode**
  (`prompt_async`) → a **second full turn runs** (double LLM spend, a second answer streamed
  into the buffer). The ingest dedupes the *final* on turnId, but opencode already
  regenerated and the live stream already double-wrote. **Not safe.**

**Conclusion: F is unsafe today.** Concurrent same-turnId collapses to one run only by
accident of the per-conversation mutex (and mis-signals 409-as-failure); sequential
re-delivery double-runs the turn.

**Smallest Go change to make concurrent same-turnId `/chat` safe:** make dispatch
**turnId-scoped** in the worker/pool. Minimum viable:

1. Add to `Worker` (guarded by `w.mu`): the **currently in-flight `turnID`** and a **bounded
   set/LRU of recently-completed `turnID`s**.
2. Replace the boolean `Claim()` with `ClaimTurn(turnID) (outcome)` in `App.Chat`, deciding
   **before** `PostMessage`:
   - `turnID` already **completed** for this worker → return a distinguished
     `ErrTurnAlreadyHandled` (a **2xx/benign no-op**, *not* 409) — never re-post to opencode.
   - `turnID` currently **in-flight** → same benign no-op (v1) or, later, **join** the existing
     stream so both callers get tokens (harder — defer).
   - a **different** in-flight `turnID` → the existing `ErrConversationBusy`/409 (a genuinely
     concurrent *different* turn).
3. Both callers (inline dispatch and the `spawnAgent` backstop) must treat
   `ErrTurnAlreadyHandled` as **success**, not a turn failure — so the loser quietly drops
   instead of terminalizing the turn.

That gives you "run exactly once per turnId, benign no-op for the redundant caller" — the
safety F needs — without yet solving the harder stream-join. Anything less (relying on the
per-conversation mutex + ingest final-dedupe) leaves both the 409-terminalize race and the
sequential double-run open.

---

## Design direction (Alex) — target-state refactor

This section records the direction Alex gave on the worker's shape. These are **his stated
opinions turned into concrete Go moves** (plus my notes) — it's a redesign brief, not a diff.
Several items directly resolve findings above (flagged inline).

### The core complaint: the abstraction is LLM-shaped and the boundaries are blurry

> *"I don't like how it's so intrinsically linked to LLMs — `turn`, `chat`, all those things.
> It's a smell. It should be generic: you do this work and give me things back while you're
> doing it, then give me a final result."*

The service is really a **generic streaming-job runner** (start a sandboxed job, stream
partial outputs, deliver one final result, heartbeat throughout) that happens to run an LLM
agent. The vocabulary (`Chat`, `ChatRequest`, `ChatSink`, `turn`, `StartTurn`) welds it to
the one caller. Target: name the ports for the **shape of the work**, not the LLM —
e.g. `Job`/`Run`, `RunRequest`, `PartialSink`/`OutputStream`, `Result`. `langy`-specific
concepts (prompt/system/model/GitHub) become the **payload** of a generic job, not the API.

### Requested moves (each: what → current state → target)

| # | Direction | Current state | Target |
|---|-----------|---------------|--------|
| A | **Prefer shared `pkg/` by default; telemetry should be shared.** "Lifecycle we already use; telemetry would be good." | `pkg/` has `lifecycle`, `otelsetup`, `clog`, `health`, `config`, `httpmiddleware`, `herr`, `retry`… but **no shared telemetry/metrics pkg** — `services/langyagent/telemetry` is bespoke. | Promote the instrument facade to `pkg/telemetry` (or fold into `pkg/otelsetup`) so every service shares one metrics idiom — **and wire the MeterProvider for real** (resolves **H1**: metrics are a no-op in prod today). |
| B | **The App "does nothing" — methods that just start telemetry and return.** | `startTurn`/`turnObserved`/`atCapacity` (app.go:297-317) are thin nil-guarded telemetry calls; `Warm`/`HasLiveWorker` are one-line delegators to the pool. `Chat` is the only method with real control flow. | Telemetry should be a **cross-cutting decorator/middleware**, not hand-rolled methods on the App. The App layer should read as orchestration logic, not `span.End()` plumbing. |
| C | **The App should CONTAIN the workers**, not treat the pool as a distant injected adapter. | The pool is a separate `adapters/workerpool` package injected via `WithWorkerPool`; the App barely touches it (delegate + telemetry). | The worker-pool/worker are the App's substance — the app layer owns them as a first-class boundary, not an arms-length port it thinly forwards to. |
| D | **Decouple naming from LLM/chat.** (the smell above) | `Chat`, `ChatRequest`, `ChatSink`, `turn`, `StartTurn`, `TurnResult` throughout. | Generic job/run/stream/result vocabulary; LLM specifics ride the payload. |
| E | **Adapters are confusing: a worker pool should be *just* a pool; the worker should be a *separate* thing that *implements* the work.** | `adapters/workerpool` (2718 LOC) mixes `pool.go`, `worker.go`, `opencode.go`, `authproxy.go`, `uid.go`, `orphan_reaper.go` in **one package**. | Split into clear units: **WorkerPool** (registry/capacity/lifecycle) · **Worker** (one running job, implements the Worker interface) · **the in-worker mechanics** (opencode client, authproxy, uid, egress) as their own boundary the Worker composes. |
| F | **GitHub as a pluggable, gateable capability.** "opencode should implement a GitHub credential + GitHub API… modular and easy to gate — if GitHub isn't enabled we don't even give it the credential." | GitHub is baked in: `buildWorkerEnv` conditionally injects `GH_TOKEN`/`GITHUB_LOGIN` (worker.go:418), `HasGithubAuth` folds into the credential signature, PR flow lives in TS `runTurn`. No clean capability seam. | A **Capability** module (GitHub = credential + API access) the worker composes only when enabled. Gate at the seam: not-enabled ⇒ the credential is never minted or injected, so the sandbox literally cannot reach GitHub. Cleaner than the denylist-env posture. |
| G | **Embed assets in the binary; stop seeding the filesystem from `entrypoint.sh`.** | `entrypoint.sh` copies `AGENTS.md.template` + `skills/` from `/opt/langy-templates` onto the `/workspace` emptyDir at pod boot; the manager reads `AGENTS.md` off disk at `Pool.New`. | `//go:embed` the templates + skills into the binary; write per-worker files from the embedded FS at spawn. Removes `entrypoint.sh`'s seeding step, the `/opt/langy-templates` image layer, and the "unreadable AGENTS.md at startup" failure mode. |
| H | **Delete `langytracebridge`.** | The self-observability span tee (152 LOC, ADR-044) registers a second span processor on the global TP. | Remove it — drops one of the four OTel surfaces (resolves part of **§3 / M4**). |
| I | **Move `telemetry` into `internal/`** — "it shouldn't be in the busiest part of the app." | `services/langyagent/telemetry` sits at the service root next to `app`, `adapters`, `domain`. | `services/langyagent/internal/telemetry` (or under a shared pkg per A) so it's plumbing, not a top-level domain concern. |
| J | **Make the domain boundaries obvious in the file layout:** transport · app · worker-pool · worker · in-worker. | Hexagonal but the interesting split (pool vs worker vs opencode-mechanics) is hidden inside one `workerpool` package; telemetry + tracebridge clutter the root. | Package layout should *show* the five boundaries at a glance (see proposed tree below). |
| K | **Heartbeat model: the worker streams heartbeat pings alongside every update; the connection stays alive on that stream, and if it drops for long enough we assume the worker is dead.** | The worker emits `langy.progress` frames on the `/chat` stream, but **nothing worker-side refreshes the control-plane liveness key** — TS `runTurn` does, on those frames (this is **G2**, the S3 blocker). | Liveness = **stream freshness**, owned by the worker: heartbeats ride the same output stream as partials; the consumer (relay/ingest) refreshes liveness on any frame and terminalizes on a silence window. **This is the design that unblocks S3-G2** and lets the liveness reactor key off "stream went quiet," not a separately-maintained Redis key. |
| L | **A screamingly-obvious branch between execution modes: local = in-memory (a goroutine), prod = gVisor super-sandboxed.** "You almost scream when you open the file structure to see that's what happens." | Isolation is a **bool threaded through spawn** (`DisableUIDIsolation` → `workerSysProcAttr`/`maybeChown`, worker.go). Always a subprocess; the flag only toggles setuid/chown. There is no structural, visible split. | A first-class **Sandbox/Runner seam** with two obvious implementations — e.g. `runner/local` (in-process/goroutine, dev) and `runner/gvisor` (sandboxed subprocess, prod) — selected once at the composition root. The execution substrate is the single most security-critical choice; the layout should make it impossible to miss. |

### Proposed target package layout (makes J + E + I + L visible)

```
services/langyagent/
  cmd/                  entrypoint (compose root: picks runner, wires deps)
  transport/            DRIVING adapter (was adapters/httpapi) — generic job API
  app/                  orchestration: OWNS the pool; generic Job/Run/Result ports
  workerpool/           JUST the pool: registry, capacity, lifecycle
  worker/               ONE worker; implements the Worker interface; composes ↓
    opencode/           the in-worker mechanics: opencode client, authproxy, session
    capability/github/  gateable GitHub capability (credential + API)   ← item F
  runner/               ← item L: the screaming branch
    local/              in-memory / goroutine (dev)
    gvisor/             sandboxed subprocess (prod)
  egress/               per-worker forward proxy (unchanged boundary)
  domain/               pure value objects + errors
  internal/telemetry/   ← item I (or promote to pkg/telemetry per item A)
  assets/               //go:embed AGENTS.md + skills/                  ← item G
  (deleted) langytracebridge/                                          ← item H
  (deleted) entrypoint.sh asset-seeding                                ← item G
```

### My notes on the direction

- **K is the keystone and it retires the messiest part of the whole system.** Making the
  worker own heartbeat-on-the-stream collapses the liveness story from *three* moving parts
  (TS `runTurn` refresh + Redis key + reconcile reactor + boot sweep) down to one invariant
  ("stream went quiet ⇒ dead"). It directly unblocks **S3-G2** and makes the **S3-#4 interval
  sweep** and much of the reconciler redundant. I'd sequence K **first** among the S3 Go work.
- **L pairs naturally with the generic-job reframe (D).** Once the API is "run a job, stream
  partials, heartbeat, return a result," a `local` goroutine runner and a `gvisor` subprocess
  runner are just two implementations of one `Runner` interface — and the security-critical
  choice becomes a single, visible line at the composition root instead of a boolean smuggled
  through `spawnInner`.
- **A + I + H together clean up the OTel mess from §3**: one shared telemetry idiom, moved to
  `internal`/`pkg`, minus the tracebridge — leaving exactly one operational-telemetry surface
  plus the per-worker opencode plugin, with the meter actually wired.
- **F is also a security win, not just modularity**: "not enabled ⇒ credential never exists"
  is strictly stronger than today's env denylist (worker.go:178), which the code itself
  flags as non-exhaustive.
- **Caveat on C ("App contains the workers"):** keep the *testability* the current port
  boundary buys — the App should own the pool as its substance, but still behind an interface
  so `app` unit tests don't need a real opencode. "Contain" structurally, not "couple to a
  concrete pool."

### How this reprioritizes the earlier recommendations

The §6 list still holds, but under this direction the ordering becomes: **(1) K** — worker-owned
heartbeat/liveness (unblocks S3, retires the reconciler/sweep); **(2) L + D** — the
runner seam + generic job vocabulary (the structural reframe everything else hangs on);
**(3) A/I/H** — telemetry to shared/`internal`, wire the meter, drop the tracebridge;
**(4) E/J** — split `workerpool` into pool/worker/opencode boundaries; **(5) F** — gateable
GitHub capability; **(6) G** — embed assets, delete the entrypoint seeding. The earlier
**H2 goroutine-guard** fix folds into (4) as the packages are reshaped.
```
