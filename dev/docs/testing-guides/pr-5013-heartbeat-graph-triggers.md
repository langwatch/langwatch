# PR #5013 testing guide — outbox heartbeat + graph triggers via outbox (ADR-033 + ADR-034 Phase 5)

Branch: `pr/04-heartbeat-graph-triggers`.
Stacked on PR #5012 — merge PR #5012 first.

## What shipped

Custom-graph threshold alerts can now fire from the event-sourced
path instead of the 3-minute K8s cron. Two pieces move together:

1. **ADR-033 outbox heartbeat primitive.** A framework-level Redis-locked,
   worker-only, leader-elected timer. Registered entries return
   `OutboxEnqueueRequest[]` and get dispatched through the same helper
   `dispatchOutboxEnqueues` that event-driven reactors use, so
   downstream dedup / retry / audit / handler are byte-identical to
   event-driven enqueues.
2. **ADR-034 Phase 5 graph trigger reactor.** A `.withOutbox(...)`
   reactor on the trace-processing pipeline that debounces per
   `(trigger, project)` 5s and dispatches breach events in real time.
   The heartbeat covers absence cases (no-data alerts and resolve-when-
   traffic-stops) that real-time can't see; 30s cadence, one canonical
   `evaluateGraphTrigger` handler regardless of what woke it up.

Both are per-project gated. When `release_es_graph_triggers_firing` is
OFF for a project, the cron continues to handle that project's graph
triggers. When ON, the cron skips them and the outbox path takes over.

## Env vars & feature flags

| Flag | Purpose | Set to enable NEW flow | Set to keep OLD flow |
|---|---|---|---|
| `release_es_graph_triggers_firing` | Per-project. Moves custom-graph threshold alerts off the K8s cron onto the outbox + heartbeat path. Cron flag-checks per trigger's project and skips flagged ones. Coexistence is safe — a project is either on the cron OR the new path, never both. | PostHog ON for canary project(s). Local: `FEATURE_FLAG_FORCE_ENABLE=release_es_graph_triggers_firing`. | Default OFF. K8s cron handles graph triggers exactly as today. |

Neither the heartbeat nor the reactor has a top-level kill switch. If
you need to disable an individual heartbeat consumer, use the ES
kill-switch family: `es-<aggregate>-<component>-<name>-killswitch`.
(The graph-trigger reactor lives on the trace pipeline; the specific
generated key is emitted by `killSwitch.ts` and visible in the ES
audit log at boot.)

## Setup

```bash
make quickstart all-local          # local CH + PG + Redis + app + workers
pnpm dev                            # from langwatch/
```

- Workers must be running (the outbox + heartbeat live under
  `processRole === "worker"` only). Watch worker boot logs for
  `heartbeat scheduler started` + a `heartbeat registered:
  graphTriggerHeartbeat`-shaped line.
- The heartbeat wants a Redis lock on the singleton key. If two worker
  replicas race, only one wins the tick — verify by grepping for
  `heartbeat leader elected` / `heartbeat leader skipped`.
- Test-tenant prep: build a custom-graph dashboard with at least one
  chart whose metric can be watched under a threshold (e.g.
  `sum(trace.cost) by time`), and attach an alert to it via the
  legacy `/analytics/custom` "Add alert" affordance for a project
  that is NOT yet flagged. Then create a second alert on a project
  that IS flagged.

## Golden path — happy flow

### 1. Un-flagged project (cron path — regression check)

1. Confirm the project does not have `release_es_graph_triggers_firing`.
2. Wait up to 3 minutes (K8s cron tick).
3. Cron log: `graphTriggerCron ran for project=<X>, triggers=<n>`.
   Any breach fires via `handleSendEmail` / `handleSendSlackMessage`
   (the hardcoded pre-Liquid path). This is the un-changed baseline.

### 2. Flagged project (real-time breach)

1. Enable `release_es_graph_triggers_firing` for the project.
2. Ingest a trace whose value pushes the metric over threshold.
3. Within seconds (bounded by the 5s per-(trigger, project) debounce),
   the outbox reactor fires. Alert email / Slack post lands.
4. Cron log for this tick: `graphTriggerCron skipped project=<X>
   flag=release_es_graph_triggers_firing`. No double-fire.

### 3. Flagged project — no-data absence

1. Same project. Configure a graph alert whose "no data" condition
   applies when traffic drops to zero.
2. Stop ingestion. Wait ~30s.
3. Heartbeat tick issues a `no-data` alert via the outbox. Same
   canonical dispatch path as the real-time breach.

### 4. Flagged project — firing resolve

1. Same project. Trigger is currently firing (breach path #2 above).
2. Stop the metric — traffic drops.
3. Within ~30s the heartbeat's resolve pass moves the alert state to
   resolved and emits the resolve notification.

### 5. Dedup

1. Same project, same trigger, same threshold — fire twice in quick
   succession.
2. Only ONE notification. Outbox dedup on
   `(reactorName, dedupKey)` collapses the second.

### 6. Flag flip mid-flight

1. Trigger currently firing via cron on an un-flagged project.
2. Flip `release_es_graph_triggers_firing` ON.
3. Cron immediately skips on the next tick. The new path takes over
   without a double-fire; the resolve on the next `heartbeat` handles
   the trigger's firing lifecycle from where cron left off.

## Regression traps — what to specifically re-verify

- **Outbox runtime attached.** Same as PR #4498 — no
  `outbox runtime attached` at worker boot means every graphEval
  enqueue silently fails. This PR extends the outbox setup path;
  make sure `presets.ts` calls `attachOutbox()` after the outbox is
  built. Regression signature: reactor's `decide` returns enqueues,
  no `ReactorOutbox` row is written, no dispatch happens.
- **Heartbeat lock TTL & shutdown wait.** Kill a worker mid-tick.
  Within `max(intervalMs * 2, 30s)` the lock releases and the next
  worker picks up. `stop()` must await `inFlightTicks` — regression
  is a `stop()` that returns immediately and leaks dispatch past
  shutdown. Verify with orderly shutdown of the worker container.
- **abortController is mutable across start/stop.** Cycle
  `stop() → start()`. Registered entries' `decide(ctx)` receives a
  FRESH `AbortSignal` — the old one is gone. Regression = decides
  fire on an already-aborted signal and skip work.
- **`.withOutbox` reactor name matches its handler name.** Eval
  reactor's `definition.name` regressed to
  `"graphTriggerEvaluation:evaluation"` in a draft — the static
  pipeline builder threw at worker boot. Regression signature:
  worker crashes on start with "unknown outbox reactor name". Handler
  name is `"graphTriggerEvaluation"` — no `:evaluation` suffix.
- **Cron flag check is per-trigger's project.** The single-line edit
  in `src/server/routes/cron.ts:434` does a per-trigger project flag
  check. If a project is flagged, all its triggers skip. If the check
  regresses to project-global-off / trigger-global-on, un-flagged
  projects double-fire.
- **Case-insensitive `Alert:` prefix.** Rename a graph alert to
  `alert: cost spike`. Save. Row must read `Alert: cost spike`, not
  `Alert: alert: cost spike`. Regression covered by the graph-alert
  builder unit tests; the case-insensitive `/^\s*alert:\s*/i` regex
  was a P0 fix.
- **`graphEval` outbox stage does not fit the (trigger, trace)
  shape.** Graph evals have no traceId — they're per-trigger, not
  per-trace. `payload.ts` has a `graphEval` stage discriminator
  distinct from settle/cadence. If a settle payload gets built with
  a graph-alert reactor's dedup key, dispatch fails silently.
- **Single handler serves both wake sources.** `evaluateGraphTrigger`
  is the ONE dispatch handler regardless of whether the event
  pipeline or the heartbeat woke it. If you see two versions of the
  handler (one for real-time, one for heartbeat), that's the exact
  duplication ADR-033 was designed to prevent.

## Rollback plan

1. Flip `release_es_graph_triggers_firing` OFF for affected projects
   in PostHog. Cron picks them up on the next 3-minute tick.
2. Any pending `graphEval` outbox rows for those projects can be
   drained safely — the handler is idempotent per `TriggerSent`.
3. If the heartbeat itself is misbehaving (log spam, lock stuck), use
   the ES kill-switch: set the generated
   `es-<aggregate>-graphTriggerHeartbeat-<name>-killswitch` to `true`
   in the operator store. The scheduler skips that consumer's tick.
4. No schema removal, no data migration. Cron K8s job is unchanged.

## Failure modes to alert on

- CloudWatch grep: `heartbeat leader lock acquisition failed` at
  sustained rate → Redis contention or lock never releasing.
- CloudWatch grep: `graphTriggerCron skipped project=<X>` where `<X>`
  is a project you did NOT flag → per-project flag check regressed.
- Sentry: `unknown outbox reactor name` at worker boot → reactor
  registration regressed. Worker won't accept traffic.
- CloudWatch grep: `no-data alert fired` frequency higher than
  configured cadence → heartbeat is firing more than once per
  `intervalMs`. Usually lock TTL / leader election regression.
- Grafana: cron dispatch count for flagged projects > 0 →
  double-fire, catastrophic.
- Sentry: `outbox runtime not attached` at boot → PR-4498 hoist
  regressed (again). This PR piggybacks on that wiring.
