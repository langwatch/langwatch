# ADR-043: Event-driven Langy turns — worker spawn, liveness reconcile, stream persistence split, self-observability

**Date:** 2026-07-10

**Status:** Draft

> **This is a design-only ADR (PR3 of 4).** It is written and merged *ahead*
> of its implementation because PR3's code depends on two changes being built
> in parallel that have not yet landed on `main`:
>
> - **PR1** — Go telemetry on the langy-agent manager plus two new adapter
>   seams in `services/langy-agent/`: `adapters/workerpool` (the pod-side
>   spawner of opencode subprocesses) and `adapters/egress` (a single
>   `http.RoundTripper` boundary every worker outbound call flows through).
>   Today the manager emits no telemetry of its own.
> - **PR2** — a `langy_conversation` event-sourcing aggregate with the events
>   and commands PR3 reacts to and dispatches (`agent_turn_started`,
>   `status_reported`, `progress_reported`, `agent_turn_failed`,
>   `turn_finalized`; `StartAgentTurn`, `RecordStatus`, `RecordProgress`,
>   `FinalizeTurn`, `ReconcileAgentTurn`).
>
> Building PR3's code against `main` now would reference symbols that do not
> exist. This ADR + its Gherkin specs (`specs/langy/langy-event-driven-turns.feature`,
> `specs/langy/langy-self-observability.feature`) + the plan
> (`specs/langy/langy-pr3-plan.md`) are the spec-first artefacts so PR3 can be
> implemented as a fast-follow the moment PR1 + PR2 merge. The exact interfaces
> and seams consumed from PR1/PR2 are pinned in **"Dependencies"** below; if
> they land with different names, this ADR is the reconciliation point.

## Context

Langy is LangWatch's in-product AI assistant. A chat turn runs an `opencode`
subprocess (one per conversation) inside the `langy-agent` pod, spawned and
fronted by a Go manager (`services/langy-agent/`). The control plane's Hono
route `POST /api/langy/chat` (`src/server/routes/langy.ts`) is the auth +
persistence + stream-bridge layer.

Today that route is **synchronous and stateless**:

1. It authenticates, resolves per-project credentials
   (`LangyCredentialService.getOrProvision`), persists the user message, and
   reserves a GitHub-PR permit.
2. It `fetch`es `POST {OPENCODE_AGENT_URL}/chat` on the manager and **holds the
   HTTP connection open for up to 120 s** (`AGENT_CHAT_TIMEOUT_MS`).
3. The manager (`handler.go::handleChat`) claims the worker (`Worker.tryClaim`),
   posts the prompt to opencode, and streams opencode's `/event` SSE back as
   NDJSON.
4. The route bridges NDJSON → a `createUIMessageStream` UI stream → browser
   tokens, then persists the assistant message and reconciles the PR permit in
   the stream executor's `finally`.

Four properties fall out of that shape, and all four are now costing us:

- **No deploy survival.** The turn lives entirely in one held-open request
  against one worker pod. A rollout of `langwatch-app` or `langy-agent` mid-turn
  drops the socket; the turn is lost with no terminal state. The route's own
  comments call this out ("no idempotency key… a mid-task failure surfaces to
  the user instead of being silently retried").
- **No refresh-resume.** Tokens exist only on the wire. A browser refresh
  during a turn loses everything streamed so far; on reconnect there is nothing
  to reattach to.
- **No liveness.** If opencode wedges (or the pod is OOM-killed), the turn hangs
  until the 120 s client timeout. There is no heartbeat and nothing sweeps a
  stalled turn to a terminal state.
- **No central observability of Langy itself.** The opencode OTel plugin exports
  gen-AI/tool spans **only to each user's own project** (`buildWorkerEnv`'s
  `OPENCODE_OTLP_*`). The manager emits nothing. The team that builds Langy has
  no aggregate view of how Langy behaves in the wild — spawn latency, stall
  rate, tool usage, egress — to improve it.

The scenario/simulation subsystem already solved the first three problems with
an **event-sourced, reactor-driven, pool-backed** execution model. A queued
event drives a `runIn:["worker"]` reactor
(`scenarioExecution.reactor.ts`) that submits to an in-process
`ScenarioExecutionPool` (`execution-pool.ts`), wired via `setPool()` in
`src/workers.ts`; a drain-on-shutdown path
(`drainInFlightRuns` + `pool.inFlightJobs`) and a startup reconciler
(`reconcileOrphanedQueuedRuns`) give every run a terminal state across worker
restarts. PR2 gives Langy the aggregate to hang the same machinery on.

The fourth problem — self-observability — is exactly the **dual-export** the AI
gateway already ships: `customertracebridge` tees gen-AI spans to the customer's
project via the `AITraceEmitter` port, using a private `TracerProvider` (empty
resource, `AlwaysSample`) whose `routerExporter` fans spans to per-project OTLP
endpoints keyed on a `langwatch.project_id` span attribute.

This ADR adapts both proven patterns to Langy.

## Decision

We will move Langy turns onto the `langy_conversation` aggregate and drive
execution off events, split token persistence from durable turn state, add a
heartbeat/reconcile liveness layer, tee Langy's own activity to an internal
LangWatch project, and observe (flag-only) every worker egress call. Five parts.

### 1. `spawnAgent` reactor + `LangyWorkerPool` (event-driven spawn)

Replace the synchronous `POST /chat` trigger with the scenario pattern.

- **New reactor** `createSpawnAgentReactor(): SpawnAgentReactorHandle` in
  `src/server/event-sourcing/pipelines/langy-processing/reactors/spawnAgent.reactor.ts`,
  a direct analog of `createScenarioExecutionReactor`. It exposes
  `{ reactor, setPool }`, runs `runIn: ["worker"]`, reacts only to
  `agent_turn_started` (an `isAgentTurnStartedEvent` type guard, mirroring
  `isSimulationRunQueuedEvent`), skips when the pool is unwired or the turn was
  already cancelled/superseded on the fold, and `pool.submit(...)`s a job
  carrying `{ tenantId(projectId), conversationId, turnId, prompt, system,
  modelOverride, actorUserId }`. Fire-and-forget: it does **not** await the
  turn, so the GroupQueue keeps draining later events for the same aggregate.

- **New pool** `LangyWorkerPool` in
  `src/server/services/langy/execution/langy-worker-pool.ts`, a direct analog of
  `ScenarioExecutionPool`: `submit`, `setSpawnFunction`, `inFlightJobs`,
  `drain`, per-turn in-flight tracking keyed by `turnId`. Concurrency here
  bounds how many manager calls one control-plane worker makes concurrently; the
  **hard capacity gate stays the manager's `ErrMaxWorkers` → "at-capacity"**, so
  the pool defers real capacity to the pod and mainly provides in-flight
  tracking, drain, and reconcile hooks. (The pod-side spawner is PR1's
  `adapters/workerpool`; the TS pool never spawns opencode itself.)

- **The spawn function** (wired in a new `langy-turn.processor.ts`, analog of
  `startScenarioProcessor`) does what the old route inline-did, minus holding a
  browser socket:
  1. `LangyCredentialService.getOrProvision({ projectId, actorUserId })`.
  2. `POST {OPENCODE_AGENT_URL}/chat` with the internal Bearer secret (the
     manager endpoint is unchanged; the *caller* moves from the route to the
     pool). PR1's `adapters/workerpool` may rename this to a spawn/turn call;
     the pool consumes whatever PR1 exposes.
  3. Bridge the NDJSON stream into the **Redis token buffer** (part 3) instead
     of a UI stream, reusing the existing `message.part.delta`/`field==="text"`
     parsing from `langy.ts`.
  4. Dispatch durable milestone commands (`RecordStatus`/`RecordProgress`) and,
     on completion, `FinalizeTurn` carrying the full assistant answer.
  5. Refresh the Redis heartbeat key every N seconds (part 2).

- **Wiring** mirrors scenarios exactly. In `src/workers.ts` under
  `processRole === "worker"`: construct the pool, `getLangySpawnAgentHandle()?.setPool(pool)`
  (a `presets.ts` global accessor set from `commands.spawnAgentHandle`, exactly
  like `__scenarioExecutionHandle`), then `startLangyTurnProcessor(pool)` and
  push its `close()` onto `shutdownHandles`. The PR2 pipeline registers the
  reactor with `.withReactor("langyTurnState", "spawnAgent", deps.spawnAgentReactor)`.

- **The route becomes a dispatcher + reader.** `POST /api/langy/chat` keeps all
  its auth/RBAC/rate-limit/permit logic, then `dispatch(StartAgentTurn{...})`
  (which the fold's busy-guard rejects if a turn is already in-flight for the
  conversation — replacing `Worker.tryClaim`'s 409) and **attaches to the token
  stream** (part 3) rather than proxying the manager. Normal turn and refresh
  turn now share one read path.

### 2. Heartbeat + reconcile (liveness, deploy-survival, resume)

- **Heartbeat is a cheap Redis liveness signal, not a durable event.** While a
  turn runs, the spawn function `SET langy:hb:{turnId} <ts> EX <2×interval>`
  (hash-tagged on conversationId — see part 3). A live worker refreshes it; a
  dead pod stops, and the key expires. Authoritative liveness is the TTL, not
  the event log. (The fold MAY cache `lastHeartbeatAt` for display only.)

- **A delayed reconcile reactor** `reconcileAgentTurn.reactor.ts`
  (`runIn:["worker"]`, `options.delay = HEARTBEAT_GRACE_MS`,
  `makeJobId: turnId`, `ttl`) arms on `agent_turn_started` and re-arms on every
  `status_reported`/`progress_reported` (those durable milestones double as the
  reconcile timer's re-arm). When it fires it checks: turn still in-flight on
  the fold **and** heartbeat key absent/stale → dispatch `ReconcileAgentTurn`.
  A healthy turn keeps emitting milestones that re-arm the timer; a stalled turn
  stops emitting, the last-armed timer fires past the grace window, and
  reconcile runs.

- **A startup + periodic sweep** `reconcileLangyTurns` (analog of
  `reconcileOrphanedQueuedRuns`, run on worker boot and on an interval) scans
  the fold for in-flight turns whose heartbeat is missing/stale and dispatches
  `ReconcileAgentTurn`. This is the **deploy-survival backstop**: when a pod is
  replaced, its per-turn timers are lost, but the next sweep on any worker
  catches the orphaned turn. Replay does not re-fire this (ADR-030 `isReplay`
  short-circuits customer-visible side effects); the sweep, not replay, drives
  recovery.

- **`ReconcileAgentTurn` applies a policy** (in PR2's command; PR3 supplies the
  behaviour it should encode):
  - **resume** — first check whether a `turn_finalized` arrived or the manager
    still owns a live worker for the conversation (`mgr.Status`/session probe);
    if so, reattach/no-op rather than respawn. Prevents duplicate side effects.
  - **retry** (`attempts < N` **and** the turn recorded no side-effecting
    progress, e.g. no `progress_reported: pr_opened`) → emit
    `agent_turn_failed(reason: "stalled")` for the current attempt, then
    `StartAgentTurn` with `attempts+1`. The fresh `agent_turn_started` re-drives
    the spawn reactor.
  - **give-up** (`attempts ≥ N`) → `agent_turn_failed(reason: "exhausted")`,
    terminal, surfaced to the user.
  - **fail-fast** (worker signalled a hard, non-retryable error — NDJSON `error`
    event, manager 4xx) → `agent_turn_failed(reason: "error", detail)`,
    terminal.

  Retry-safety is gated on turn idempotency, which Langy does **not** have today
  (a re-driven turn could open a second PR). Until an idempotency key exists on
  the manager side, a turn that made side-effecting progress is **not** retried
  — it gives up and surfaces. This is the same hazard the current route documents
  and refuses to auto-retry; reconcile inherits that conservatism.

### 3. Streaming + refresh-resume (persistence split)

Persistence is split by durability class — this is a firm decision, not an
option:

- **Tokens live only in a short-lived Redis buffer**, keyed per `(conversation,
  turn)`, **never in the event log.** A Redis **Stream** at
  `langy:stream:{{conversationId}}:{turnId}` (hash-tag on conversationId so the
  stream, heartbeat, and any pub/sub for a conversation share a cluster slot —
  ADR-006). The spawn function `XADD`s a chunk every ~50–100 tokens with
  `MAXLEN ~ N` trimming; TTL 2–5 min via `EXPIRE` refreshed on each append; a
  terminal `{type:"end"}` entry marks completion.

- **`status_reported` / `progress_reported` ARE durable events** — the milestone
  skeleton (tool started, PR opened, "searching traces…") survives forever on
  the aggregate.

- **`turn_finalized` carries the whole final answer** as a durable event; it is
  the source of truth for a finished turn (and what `persistMessage` used to
  write becomes a projection of it).

- **Refresh-resume** (one read path for both normal and reconnecting clients):
  1. Read the latest turn's state from the fold.
  2. **Finished** (`turn_finalized` present) → return the final answer from the
     event. No Redis needed. Idempotent.
  3. **In-flight** → `XRANGE langy:stream:{turn} - +` to replay the buffered
     tail, then `XREAD BLOCK` from the last-seen id to stream the live edge
     until the terminal marker. **One primitive** (Redis Streams) gives gap-free
     replay + live attach; capturing the last-id between replay and block read
     closes the pub/sub race where a chunk emitted in the gap is lost.
  4. **In-flight but the Redis buffer aged out** (long turn past TTL, or pod died
     and buffer expired) → the durable `status_reported`/`progress_reported`
     milestones ARE the resumable state; render those and show "still
     working — reconnect shortly", while reconcile (part 2) decides retry vs
     give-up. Tokens are best-effort; milestones are the guarantee.

### 4. Dogfood / self-observability (internal project tee)

Tee Langy's own activity to a single internal LangWatch project so the team can
observe and improve Langy — mirroring `customertracebridge`.

- **Manager-side dual-export (target).** PR1 gives the manager OTel. Point the
  worker's `OPENCODE_OTLP_ENDPOINT` (in `buildWorkerEnv`) at a **manager-local
  OTLP receiver** instead of straight at the user's project. The manager fans
  each span to **two** exporters, exactly like `routerExporter`: (a) the user's
  project (as today — this behaviour must not regress), and (b) a **static
  internal-project exporter** configured from new env
  `LANGY_INTERNAL_OTLP_ENDPOINT` + `LANGY_INTERNAL_OTLP_HEADERS` (the internal
  project's ingest key). When the internal env is unset (self-hosted, or the tee
  is disabled), no tee happens — behaviour is exactly today's single export. The
  manager's own PR1 spans (spawn, turn lifecycle, heartbeat, reconcile, egress —
  part 5) also go to the internal project, giving the "how does Langy-the-system
  behave" view.

- **Content governance (decision required — flagged).** Teeing a user's actual
  conversation content (`gen_ai.input/output.messages`) into LangWatch's own
  project is a data-governance step. Default posture in this ADR: the internal
  tee **strips message-content attributes** and keeps structural/behavioural
  signal (span shape, tool names, model, token counts, latency, status, egress),
  so the team gets Langy-behaviour observability without ingesting customer
  conversation bodies. Full-content teeing, if wanted, must be a separate,
  explicit, consented switch. `dropFilterExporter` is the precedent for
  "started/ended in-process but attribute-filtered before export."

- **Cheaper v1 fallback (if the manager-local receiver is deferred):** keep
  opencode → user project unchanged and tee **only the manager's own PR1 spans**
  to the internal project. That yields spawn/stall/egress observability
  immediately with no OTLP receiver in the manager, but the internal project
  does not see gen-AI/tool spans. Recommended only as a stepping stone.

### 5. Egress monitoring (F2a, monitor-only)

Instrument PR1's `adapters/egress` seam — the single `http.RoundTripper` every
worker outbound call passes through.

- For each outbound call emit a **span** `langy.egress` and **metrics**
  (`langy_egress_requests_total`, `langy_egress_bytes`) with attributes:
  destination host/port, bytes up/down, TLS state (version + SNI, or "plaintext"
  if no TLS), and which worker/conversation (UID → conversationId).
- A **scorer flags** suspicious shapes and sets `langy.egress.flagged=true` +
  `langy.egress.flag_reason`, grounded in ADR-033's threat model and
  `charts/langy-agent/templates/networkpolicy.yaml`: egress to a non-allowlisted
  host, plaintext HTTP to an external destination, a call toward the private
  ranges the NetworkPolicy denies (`10/8`, `172.16/12`, `192.168/16`) or the
  cloud metadata IP (`169.254.169.254`), exfil-shaped large uploads, and
  high fan-out to many distinct hosts in one turn.
- **Flag only — never block.** These spans/metrics go to the internal project
  (part 4). Enforcement (dropping/killing on a flag) is **PR4**; PR3 observes so
  PR4 has ground truth to tune thresholds against before it starts blocking.

## Rationale / Trade-offs

- **Reuse over reinvention.** Every moving part is an established pattern: the
  reactor+pool+drain+reconcile machinery is lifted from scenarios; the
  dual-export is lifted from the gateway. This keeps PR3 small and legible and
  means the on-call model, the ADR-030 replay semantics, and the GroupQueue
  routing already apply.
- **Durability class drives storage.** Tokens are high-volume, low-value-at-rest,
  and only interesting live — Redis with a TTL is right; putting them on the
  immutable event log would bloat it for no replay value. Milestones and the
  final answer are low-volume and valuable forever — events are right. The split
  is the whole point of part 3.
- **Liveness without event-log pollution.** A per-second heartbeat as events
  would flood the log; as a Redis TTL key it is invisible to replay and self-
  cleaning. The durable milestones re-arm the reconcile timer, so we get precise
  liveness without a dedicated heartbeat event stream.
- **Conservative retry.** Because Langy turns are not idempotent, blind retry
  could double-open PRs. Reconcile retries only turns with no side-effecting
  progress and otherwise surfaces — accepting "occasionally a stalled turn ends
  as a user-visible failure" over "occasionally we open two PRs." Making turns
  idempotent (a manager-side idempotency key) is the follow-up that lifts this.
- **Observe before enforce.** Egress is flag-only in PR3 so PR4's enforcement is
  tuned against real traffic, not guesses — a compromised-worker false-positive
  that kills a legitimate `npm install` is worse than a one-PR observation delay.
- **Cost of the internal tee.** Dual-export doubles OTLP volume for Langy spans
  and ingests into an internal project we pay to store. Stripping content
  (part 4) and sampling the internal exporter bound that. Accepted for the
  ability to actually improve Langy.

## Consequences

- `POST /api/langy/chat` stops proxying the manager; it dispatches
  `StartAgentTurn` and reads the token stream. The 120 s held-open request and
  `isAgentHealthy` preflight are retired in favour of async spawn + reconcile.
  The GitHub-PR permit lifecycle (`reserveLangyGithubPrPermit` …
  `recordExtraLangyGithubPrs`), today tightly coupled to the stream executor's
  `finally`, must move to command-dispatch + a `turn_finalized` reactor — called
  out as a migration risk in the plan.
- `src/workers.ts` gains a Langy block mirroring the scenario block (pool +
  processor + `setPool` + shutdown handle). `presets.ts` gains a
  `getLangySpawnAgentHandle()` accessor. The PR2 pipeline gains two reactors and
  the reconcile command.
- The manager (`services/langy-agent/`) gains a local OTLP receiver + fan-out
  exporter (or, in the fallback, just its own PR1 spans exported to the internal
  project), reads `LANGY_INTERNAL_OTLP_*`, and instruments `adapters/egress`.
  `buildWorkerEnv`'s `OPENCODE_OTLP_ENDPOINT` retargets to the manager-local
  receiver under the target design.
- New env: `LANGY_INTERNAL_OTLP_ENDPOINT`, `LANGY_INTERNAL_OTLP_HEADERS` (manager
  + `.env.example`). New Redis keyspace: `langy:stream:*`, `langy:hb:*`.
- Deploy survival and refresh-resume both fall out of the same event-sourced
  turn + reconcile machinery — one mechanism, two features.
- **Hard dependency ordering:** PR3 cannot merge before PR1 (seams) and PR2
  (aggregate). If PR1/PR2 land with different symbol names than pinned in
  "Dependencies", update that section and the plan before implementing.
- Enforcement of egress flags, per-user cost attribution on the internal tee,
  and turn idempotency are explicitly **out of scope** (PR4 / follow-ups).

## Dependencies (interfaces & seams consumed)

**From PR2 (`langy_conversation` aggregate — `src/server/event-sourcing/pipelines/langy-processing/`):**

| Symbol | Kind | PR3 use |
|---|---|---|
| `agent_turn_started` | event | `spawnAgent` reactor reacts; reconcile arms |
| `status_reported`, `progress_reported` | events | durable milestones; re-arm reconcile timer; resumable skeleton |
| `turn_finalized` | event | carries full answer; finished-turn source of truth |
| `agent_turn_failed` | event | reconcile terminal outcomes |
| `StartAgentTurn` | command | route dispatches; reconcile re-dispatches on retry |
| `RecordStatus`, `RecordProgress` | commands | spawn function dispatches milestones |
| `FinalizeTurn` | command | spawn function dispatches on completion |
| `ReconcileAgentTurn` | command | encodes the resume/retry/give-up/fail-fast policy above |
| `langyTurnState` fold projection | projection | in-flight/turn state read by reactors, sweep, route |

**From PR1 (`services/langy-agent/`):**

| Seam | PR3 use |
|---|---|
| Go telemetry init (`serve.go`) | manager tracer/meter the internal tee + egress spans hang on |
| `adapters/workerpool` | pod-side opencode spawner the TS pool's spawn function calls |
| `adapters/egress` (`http.RoundTripper` boundary) | instrumented in part 5 (spans + metrics + flag scorer) |

**Consumed unchanged from `main`:** `ScenarioExecutionPool` / `createScenarioExecutionReactor`
/ `startScenarioProcessor` / `src/workers.ts` wiring (pattern to copy);
`LangyCredentialService.getOrProvision`; `customertracebridge` (`Emitter`,
`Registry`, `routerExporter`, `dropFilterExporter`, `AITraceEmitter`,
`SetFromBundle`, `normalizeEndpoint` — pattern to copy for the manager tee);
`handler.go::handleChat` + `buildWorkerEnv` + `ErrMaxWorkers`; reactor framework
`ReactorOptions { delay, ttl, makeJobId, runIn }` + `ReactorContext.isReplay`.

## References

- Specs: `specs/langy/langy-event-driven-turns.feature`,
  `specs/langy/langy-self-observability.feature`
- Plan: `specs/langy/langy-pr3-plan.md`
- Related ADRs: 033 (langy worker network isolation — threat model),
  002 / 007 (event sourcing), 006 (Redis cluster hash tags), 023 / 025
  (orphan-sweep reactor chain — reconcile precedent), 030 (replay short-circuit
  of side effects), 017 (gateway trace payload capture), 039 (outbox heartbeat)
- Reference code: `src/server/event-sourcing/pipelines/simulation-processing/reactors/scenarioExecution.reactor.ts`,
  `src/server/scenarios/execution/execution-pool.ts`,
  `src/server/scenarios/scenario.processor.ts`, `src/workers.ts`,
  `src/server/routes/langy.ts`, `src/server/services/langy/LangyCredentialService.ts`,
  `services/aigateway/adapters/customertracebridge/`,
  `services/langy-agent/worker.go` (`buildWorkerEnv`), `services/langy-agent/handler.go`,
  `charts/langy-agent/templates/networkpolicy.yaml`
