# Langy PR3 — event-driven worker + streaming + self-observability — implementation plan

> **ADR:** `dev/docs/adr/044-langy-event-driven-turns.md`
> **Specs:** `specs/langy/langy-event-driven-turns.feature`,
> `specs/langy/langy-self-observability.feature`
> **Branch:** `design/langy-pr3` (this PR ships docs only)
> **Blocked on:** PR1 (langy-agent Go telemetry + `adapters/workerpool` +
> `adapters/egress`) and PR2 (`langy_conversation` aggregate + events +
> commands). Do not start coding until both merge; then implement in the order
> below.

This plan is deliberately concrete: it names the real symbols PR3 copies from
and the exact seams it consumes, so the fast-follow is mechanical.

## The pattern being copied (read these first)

| Concern | Reference (scenarios/gateway) | PR3 analog (langy) |
|---|---|---|
| Event → spawn reactor | `createScenarioExecutionReactor()` in `src/server/event-sourcing/pipelines/simulation-processing/reactors/scenarioExecution.reactor.ts` | `createSpawnAgentReactor()` |
| In-process pool | `ScenarioExecutionPool` in `src/server/scenarios/execution/execution-pool.ts` | `LangyWorkerPool` |
| Spawn fn + processor | `startScenarioProcessor()` in `src/server/scenarios/scenario.processor.ts` | `startLangyTurnProcessor()` |
| Worker wiring | `src/workers.ts` scenario block (`setPool` + `startScenarioProcessor` + shutdown handle) | langy block |
| Global handle accessor | `getScenarioExecutionHandle()` in `src/server/app-layer/presets.ts` (`__scenarioExecutionHandle`) | `getLangySpawnAgentHandle()` (`__langySpawnAgentHandle`) |
| Pipeline registration | `.withReactor("simulationRunState", "scenarioExecution", …)` in `simulation-processing/pipeline.ts` | `.withReactor("langyTurnState", "spawnAgent", …)` (PR2 pipeline) |
| Startup reconciler | `reconcileOrphanedQueuedRuns()` + `ORPHAN_QUEUED_THRESHOLD_MS` in `scenario-orphan-reconciler.ts` | `reconcileLangyTurns()` |
| Drain-on-shutdown | `drainInFlightRuns()` + `pool.inFlightJobs` | same shape |
| Delayed dedup reactor | `ReactorOptions { delay, ttl, makeJobId }` (`reactor.types.ts`) | `reconcileAgentTurn` reactor |
| Dual OTLP export | `services/aigateway/adapters/customertracebridge/` (`Emitter`, `routerExporter`, `dropFilterExporter`, `AITraceEmitter`, `normalizeEndpoint`) | manager-side `langytracebridge` |

## Consumed from PR1 / PR2 (do not build these here)

- **PR2 events:** `agent_turn_started`, `status_reported`, `progress_reported`,
  `turn_finalized`, `agent_turn_failed`. **PR2 commands:** `StartAgentTurn`,
  `RecordStatus`, `RecordProgress`, `FinalizeTurn`, `ReconcileAgentTurn`.
  **PR2 fold:** `langyTurnState` (in-flight flag, attempts, latest turnId,
  optional `lastHeartbeatAt` display cache). **PR2 pipeline dir:**
  `src/server/event-sourcing/pipelines/langy-processing/`.
- **PR1 seams:** manager OTel init in `services/langy-agent/serve.go`;
  `services/langy-agent/adapters/workerpool` (opencode spawner);
  `services/langy-agent/adapters/egress` (one `http.RoundTripper` all worker
  outbound calls pass through).

If any name differs when PR1/PR2 land, reconcile the ADR "Dependencies" table
and this section first, then implement.

## Build order

### Step 0 — regenerate + branch
`pnpm start:prepare:files` in `langwatch/`. Branch `feat/langy-pr3-event-driven`
off the merged PR2 head.

### Step 1 — Redis token buffer module (foundation, no PR2/PR1 needed to unit-test)
New `src/server/services/langy/streaming/langyTokenBuffer.ts`.

- **Key shape (hash-tagged on conversationId so buffer + heartbeat + pub/sub
  colocate on one cluster slot — ADR-006):**
  - stream: `langy:stream:{<conversationId>}:<turnId>`
  - heartbeat: `langy:hb:{<conversationId>}:<turnId>`
- **Backing structure:** Redis **Stream** (`XADD`/`XRANGE`/`XREAD BLOCK`) — one
  primitive gives ordered ids + gap-free replay + live blocking read, so a chunk
  emitted between "replay tail" and "attach live" is never lost (the pub/sub
  race). Do **not** use pub/sub for the live edge.
- **Writer API:**
  - `appendChunk({ conversationId, turnId, text })` — buffers deltas, flushes an
    `XADD * type delta text <joined>` every ~50–100 tokens; `XADD … MAXLEN ~ 2000`
    to bound length; `EXPIRE <key> 300` (2–5 min) refreshed on each flush.
  - `markEnd({ conversationId, turnId })` — `XADD * type end`.
  - `heartbeat({ conversationId, turnId })` — `SET langy:hb:{…} <now> EX <2×interval>`.
- **Reader API:**
  - `readTail({ conversationId, turnId })` → `XRANGE key - +`, returns entries +
    the last id.
  - `follow({ conversationId, turnId, fromId })` → async iterator over
    `XREAD BLOCK <n> STREAMS key <fromId>`, ends on the `type=end` entry.
  - `liveness({ conversationId, turnId })` → `EXISTS`/`GET` on the hb key +
    freshness check.
- **Config:** `CHUNK_TOKENS=64`, `STREAM_TTL_MS=180_000`,
  `HEARTBEAT_INTERVAL_MS=5_000`, `HEARTBEAT_GRACE_MS=30_000` in a
  `langy.streaming.constants.ts` (mirrors `scenario.constants.ts`).
- **Tests:** `langyTokenBuffer.unit.test.ts` against a Redis mock / testcontainer
  — append→readTail→follow ordering, MAXLEN trim, TTL set, end marker,
  heartbeat set/expire. Verifies the resume race is closed (append during the
  replay→follow gap is still delivered).

### Step 2 — `LangyWorkerPool` (copy `ScenarioExecutionPool`)
New `src/server/services/langy/execution/langy-worker-pool.ts`.

- Job shape `LangyTurnJobData { projectId, conversationId, turnId, prompt,
  system, modelOverride?, actorUserId }` (analog of `ExecutionJobData`).
- Same members: `submit`, `setSpawnFunction`, per-turn in-flight map keyed by
  `turnId`, `inFlightJobs`, `drain`, `activeCount`/`pendingCount`. Concurrency
  from `LANGY_WORKER.CONCURRENCY`.
- Difference from scenarios: the pool does **not** spawn a child process; its
  `SpawnFunction` calls the Go manager (step 3). Hard capacity stays the
  manager's `ErrMaxWorkers`; the pool's concurrency only bounds concurrent
  manager calls per control-plane worker. Keep `inFlightJobs` so `drain` can
  emit a terminal `agent_turn_failed` for anything mid-flight on shutdown
  (mirror `drainInFlightRuns`).
- **Tests:** `langy-worker-pool.unit.test.ts` — buffering at capacity, dequeue on
  completion, drain emits terminal failures, in-flight tracking covers the
  pre-registration window.

### Step 3 — turn processor + spawn function (copy `startScenarioProcessor`)
New `src/server/services/langy/execution/langy-turn.processor.ts`.

- `startLangyTurnProcessor(pool)`:
  1. `pool.setSpawnFunction(async (job) => runTurn(job, deps))`.
  2. Start the reconcile sweep (step 5) on boot + interval.
  3. Return `{ close }` that runs `drainInFlightRuns`-equivalent then clears the
     interval. Push onto `shutdownHandles` in `workers.ts`.
- `runTurn(job, deps)` — the spawn function; what `langy.ts`'s stream executor
  did, minus the browser socket:
  1. `LangyCredentialService.getOrProvision({ projectId, actorUserId })`
     (reuse verbatim — includes GitHub token mint + VK).
  2. `POST {OPENCODE_AGENT_URL}/chat` with `Authorization: Bearer <LANGY_INTERNAL_SECRET>`
     and body `{ conversationId, prompt, system, credentials, modelOverride }`
     (unchanged wire shape from `handler.go::chatRequest`; if PR1's
     `adapters/workerpool` exposes a spawn/turn endpoint, call that instead).
  3. Bridge NDJSON exactly as `langy.ts` does today (`message.part.delta` with
     `properties.field==="text"`, legacy `text` shape) — but sink deltas into
     `langyTokenBuffer.appendChunk` instead of `writer.write`.
  4. `heartbeat()` on a `HEARTBEAT_INTERVAL_MS` timer for the turn's life.
  5. Dispatch `RecordStatus`/`RecordProgress` on the agent's progress sentinels
     (`[langy:progress:*]`, reuse `githubProgressEvents.ts` / `langySentinels.ts`).
  6. On completion: `dispatch(FinalizeTurn{ conversationId, turnId, answer:
     stripLangySentinels(fullText) })`, then `markEnd()`.
  7. On manager error / NDJSON `error` event / transport failure: dispatch
     `agent_turn_failed(reason:"error", detail)`, `markEnd()`.
- **GitHub-PR permit migration (highest-risk item — call out in the PR).** Today
  the permit lifecycle (`reserveLangyGithubPrPermit` → strip `githubToken` when
  over-cap → `recordExtraLangyGithubPrs` reconcile in the executor `finally`) is
  bound to the synchronous stream. Move it to: **reserve at command dispatch**
  (route, step 4) so the cap still gates `githubToken` before the worker spawns;
  **reconcile + release on `turn_finalized`** via a small reactor
  (`langyPrPermitReconcile.reactor.ts`) that reads `progress_reported: pr_opened`
  count and calls `recordExtraLangyGithubPrs` / release. Preserve the exact
  release-only-if-`permit.reserved` and latch semantics from `langy.ts` (the
  erosion-via-blip bug). This is the one place a naive port re-introduces a
  known cap-bypass — port the comments too.
- **Tests:** `langy-turn.processor.integration.test.ts` — mock manager NDJSON,
  assert buffer appends, milestone dispatches, `FinalizeTurn` with stripped text,
  heartbeat refresh, error path dispatches `agent_turn_failed`.

### Step 4 — spawnAgent reactor + route becomes dispatcher/reader
New `src/server/event-sourcing/pipelines/langy-processing/reactors/spawnAgent.reactor.ts`
(copy `scenarioExecution.reactor.ts` line-for-line structure):

```
createSpawnAgentReactor(): { reactor, setPool }
  reactor.options = { runIn: ["worker"] }
  handle(event, ctx):
    if (!isAgentTurnStartedEvent(event)) return
    if (!pool) { warn; return }
    if (ctx.foldState.cancelledAt || ctx.foldState.supersededTurnId) return
    pool.submit({ projectId: String(event.tenantId), conversationId,
                  turnId, prompt, system, modelOverride, actorUserId })
```

`presets.ts`: add `getLangySpawnAgentHandle()` reading
`(globalForApp).__langySpawnAgentHandle`, set from `commands.spawnAgentHandle`
in the pipeline construction block (mirror the two `__scenarioExecutionHandle`
sites).

`src/server/routes/langy.ts` — `POST /langy/chat` rewrite:
- Keep everything up to and including credential/model-allowlist checks, rate
  limit, RBAC loop, `persistMessage(user)`, and permit **reserve**.
- Replace the `fetch(agentUrl/chat)` + `createUIMessageStream` executor with:
  1. `dispatch(StartAgentTurn{ projectId, conversationId, prompt: userText,
     system, modelOverride, actorUserId, permit })`. The fold busy-guard returns
     "already in flight" → respond 409 conversation-busy (replaces
     `Worker.tryClaim`).
  2. Build the response stream by attaching to `langyTokenBuffer`: read fold
     turn state → if finished, emit `turn_finalized.answer`; else
     `readTail` then `follow` until end. Keep the `x-langy-conversation-id`
     header and the `createUIMessageStream` envelope so the client is unchanged.
- New `GET /langy/conversations/:id/stream?turnId=` (or fold the attach into the
  existing GET) so a refreshed client reattaches without POSTing a new message.
- **Tests:** extend `langy-route-auth.test.ts` / `langy-chat-rbac.unit.test.ts`;
  new `langy-chat-resume.integration.test.ts` (POST starts a turn + streams;
  second client attaches mid-turn and sees tail + live edge; finished turn
  serves from `turn_finalized`).

### Step 5 — reconcile (delayed reactor + sweep)
New `reconcileAgentTurn.reactor.ts` in the PR2 reactors dir:
- `options = { runIn:["worker"], delay: HEARTBEAT_GRACE_MS,
  makeJobId: ({event}) => turnId, ttl: HEARTBEAT_GRACE_MS*2 }`.
- Arms on `agent_turn_started`; re-arms on `status_reported`/`progress_reported`
  (shouldReact returns true for those three, false otherwise).
- `handle`: if turn still in-flight on the fold AND `langyTokenBuffer.liveness`
  stale/absent → `dispatch(ReconcileAgentTurn{ conversationId, turnId })`.
- Register with `.withReactor("langyTurnState", "reconcileAgentTurn", …)` (PR2
  pipeline).

New `src/server/services/langy/execution/langy-turn-reconciler.ts` (copy
`scenario-orphan-reconciler.ts`):
- `reconcileLangyTurns({ findInFlight, checkLiveness, dispatchReconcile, now,
  thresholdMs })` — scan fold for in-flight turns with stale/absent heartbeat,
  dispatch `ReconcileAgentTurn`. Run at processor boot + on a `setInterval`
  (cap the interval well under the 5-min Redis TTL; e.g. 20 s).
- `ReconcileAgentTurn`'s policy lives in PR2's command; PR3's reconciler just
  detects and dispatches. Policy (encode in PR2, asserted by PR3 specs): resume
  (finalized/live worker) → retry (`attempts<N` && no side-effecting progress) →
  give-up (`attempts>=N`) → fail-fast (hard error).
- **Tests:** `langy-turn-reconciler.integration.test.ts` — stalled turn with no
  progress retries; exhausted turn gives up; turn with `pr_opened` progress is
  not retried; deploy case (heartbeat expired, no live timer) is caught by the
  sweep.

### Step 6 — worker wiring
`src/workers.ts`, add under `processRole === "worker"` (copy the scenario block
verbatim in structure):
```
const { LangyWorkerPool } = await import("./server/services/langy/execution/langy-worker-pool");
const { startLangyTurnProcessor } = await import("./server/services/langy/execution/langy-turn.processor");
const langyPool = new LangyWorkerPool({ concurrency: LANGY_WORKER.CONCURRENCY });
getLangySpawnAgentHandle()?.setPool(langyPool);
const langyProcessor = await startLangyTurnProcessor(langyPool);
if (langyProcessor) shutdownHandles.push(() => langyProcessor.close());
```
Web process gets no pool (worker-only, per the outbox worker-only rule).

### Step 7 — manager dual-export (self-observability, part 4) [Go]
New `services/langy-agent/langytracebridge/` (copy `customertracebridge`):
- A private `TracerProvider` (empty resource, `AlwaysSample`) whose exporter
  fans each span to **two** sinks: the user's project (per-span
  `langwatch.project_id` → `routerExporter`, as the worker does today) and a
  **static internal exporter** built from `LANGY_INTERNAL_OTLP_ENDPOINT` +
  `LANGY_INTERNAL_OTLP_HEADERS`. Reuse `normalizeEndpoint` (appends
  `/v1/traces`).
- Retarget `buildWorkerEnv`'s `OPENCODE_OTLP_ENDPOINT` at a manager-local OTLP
  receiver so opencode spans flow through the manager (which then dual-exports).
  Keep the user-project export byte-identical to today.
- **Content strip on the internal sink:** a `dropContentExporter` (analog of
  `dropFilterExporter`) that strips `gen_ai.input.messages` /
  `gen_ai.output.messages` before the internal export. Default on.
- Manager's own PR1 spans (spawn, turn lifecycle, reconcile) already flow to the
  internal exporter since they originate on the manager tracer.
- **Fallback if the local receiver is deferred:** skip the opencode retarget;
  export only manager PR1 spans to the internal project. Ship as a stepping
  stone, follow up with the receiver.
- **Tests:** Go — `langytracebridge_test.go` (fan-out to both sinks; internal
  sink omits message content; no internal env → single export only).

### Step 8 — egress monitoring (part 5, flag-only) [Go]
Instrument PR1's `services/langy-agent/adapters/egress` `http.RoundTripper`:
- Per call: start span `langy.egress` (kind client) with `server.address`,
  `server.port`, bytes up/down, `tls.protocol.version`/SNI (or a
  `langy.egress.plaintext=true` flag), `langy.conversation.id`, worker UID.
  Metrics `langy_egress_requests_total{host,flagged}`, `langy_egress_bytes`.
- `scoreEgress()` sets `langy.egress.flagged=true` + `langy.egress.flag_reason`
  for: host outside the allowed set (control plane, gateway, git/gh/registry
  hosts), plaintext to external, destination in `10/8`/`172.16/12`/`192.168/16`
  or `169.254.0.0/16` (metadata), large-upload/exfil shape, high distinct-host
  fan-out per turn. Grounded in `charts/langy-agent/templates/networkpolicy.yaml`
  + ADR-033.
- **Never block.** Only observe + flag; spans go to the internal project.
- **Tests:** Go — `egress_scorer_test.go` (each flag reason; allowed TLS host not
  flagged; blocking never invoked).

### Step 9 — env + chart + docs
- `.env.example` + `langwatch/env.mjs`: `LANGY_INTERNAL_OTLP_ENDPOINT`,
  `LANGY_INTERNAL_OTLP_HEADERS` (optional; unset = no tee). Manager config
  (`services/langy-agent/config.go`) reads them.
- `charts/langy-agent`: values for the internal OTLP endpoint/secret;
  NetworkPolicy egress already permits the control-plane/gateway sinks — confirm
  the internal OTLP endpoint is reachable (it is the control plane's ingest, so
  the existing control-plane egress rule covers it).
- Update `dev/docs/best_practices` only if a new streaming/resume UI pattern
  emerges on the client; the client envelope is unchanged so likely none.

## Test strategy (outside-in)

1. Bind the two `.feature` files first (remove `@unimplemented` per scenario as
   coverage lands).
2. Integration before unit: route resume test (step 4) and reconciler test
   (step 5) are the load-bearing ones — they prove deploy-survival + refresh.
3. Redis-backed tests use a testcontainer (match the CI ClickHouse/Redis pin
   discipline). Scenario/user-sim fixtures, if any, use `openai("gpt-5-mini")`.
4. Run end-to-end locally (no `CI=1`) before opening the PR.

## Risks / open questions (flag for review)

- **Streaming-resume mechanism.** Chose Redis **Streams** (`XRANGE` tail +
  `XREAD BLOCK` live) over List+pub/sub specifically to close the replay→attach
  gap race. Confirm we're happy adding a `langy:stream:*` keyspace to the
  cluster and the TTL/MAXLEN bounds. Alternative if Streams are unwanted:
  List + a monotonic "last delivered index" the reader long-polls — more code,
  same guarantee.
- **Internal-project content.** Default strips user message/answer text from the
  internal tee (behaviour-only observability). If the team wants full-content
  dogfooding, that's a separate consented switch — needs a data-governance call.
- **GitHub-PR permit migration** is the riskiest port: moving the reserve/
  reconcile/release out of the synchronous `finally` into dispatch + a
  `turn_finalized` reactor must preserve the `permit.reserved`-gated release and
  the per-PR (not per-turn) reconcile, or it re-opens the documented cap-bypass.
- **Retry idempotency.** Reconcile refuses to retry turns that made side-
  effecting progress (no idempotency key exists yet). A manager-side idempotency
  key is the follow-up that would let stalled-after-PR turns retry safely.
- **Manager-local OTLP receiver** is the one genuinely new piece of Go infra
  (steps 7). If it slips, ship the step-7 fallback (manager spans only) so the
  self-observability value lands without blocking on the receiver.
