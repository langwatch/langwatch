# PR #5013 testing guide — outbox heartbeat + graph triggers via outbox (ADR-039 + ADR-034 Phase 5)

Branch: `pr/04-heartbeat-graph-triggers`. Stacked on PR #5012 — merge it first.

## What shipped

Custom-graph threshold alerts can now fire from the event-sourced path
instead of the 3-minute K8s cron. Two pieces move together:

1. **ADR-039 outbox heartbeat primitive.** A framework-level
   Redis-locked, worker-only, leader-elected timer. Registered entries
   return `OutboxEnqueueRequest[]` and dispatch through the same
   `dispatchOutboxEnqueues` helper event-driven reactors use, so
   downstream dedup / retry / audit / handler are byte-identical.
2. **ADR-034 Phase 5 graph trigger reactor.** A `.withOutbox(...)`
   reactor on the trace pipeline that debounces per `(trigger, project)`
   5s and dispatches breach events in real time. The heartbeat covers
   absence cases (no-data alerts, resolve-when-traffic-stops) real-time
   can't see; 30s cadence, one canonical `evaluateGraphTrigger` handler
   regardless of what woke it.

Both are per-project gated. When `release_es_graph_triggers_firing` is
OFF for a project the cron handles its graph triggers; ON, the cron skips
them and the outbox path takes over.

## Env vars & feature flags

| Flag | Purpose | Set to enable NEW flow | Set to keep OLD flow |
|---|---|---|---|
| `release_es_graph_triggers_firing` | Per-project. Moves custom-graph threshold alerts off the K8s cron onto the outbox + heartbeat path. Cron flag-checks per trigger's project and skips flagged ones. Coexistence is safe — a project is on the cron OR the new path, never both. | PostHog ON for canary project(s). Local: `FEATURE_FLAG_FORCE_ENABLE=release_es_graph_triggers_firing`. | Default OFF. K8s cron handles graph triggers as today. |

Neither the heartbeat nor the reactor has a top-level kill switch. To
disable an individual heartbeat consumer, use the ES kill-switch family
`es-<aggregate>-<component>-<name>-killswitch`. (The reactor lives on the
trace pipeline; the generated key is emitted by `killSwitch.ts` and
visible in the ES audit log at boot.)

## Setup

```bash
make quickstart all-local          # local CH + PG + Redis + app + workers
pnpm dev                            # from langwatch/
```

- Workers must be running (outbox + heartbeat live under
  `processRole === "worker"` only). Watch worker boot for `heartbeat
  scheduler started` + a `heartbeat registered: graphTriggerHeartbeat`
  line.
- The heartbeat wants a Redis lock on the singleton key. If two replicas
  race, only one wins the tick — grep for `heartbeat leader elected` /
  `heartbeat leader skipped`.
- Test-tenant prep: a custom-graph dashboard with ≥1 chart whose metric
  can be watched under a threshold (e.g. `sum(trace.cost) by time`).
  Attach an alert via the legacy `/analytics/custom` "Add alert"
  affordance on a project NOT yet flagged, then a second alert on a
  project that IS flagged.

## Golden path — happy flow

### 1. Un-flagged project (cron path — regression check)

1. Confirm the project lacks `release_es_graph_triggers_firing`.
2. Wait up to 3 minutes (cron tick).
3. Cron log: `graphTriggerCron ran for project=<X>, triggers=<n>`. Any
   breach fires via `handleSendEmail` / `handleSendSlackMessage` (the
   hardcoded pre-Liquid path). Un-changed baseline.

### 2. Flagged project (real-time breach)

1. Enable `release_es_graph_triggers_firing`.
2. Ingest a trace whose value pushes the metric over threshold.
3. Within seconds (bounded by the 5s per-(trigger, project) debounce) the
   outbox reactor fires. Alert email / Slack post lands.
4. Cron log this tick: `graphTriggerCron skipped project=<X>
   flag=release_es_graph_triggers_firing`. No double-fire.

### 3. Flagged project — no-data absence

1. Same project. Configure a graph alert whose "no data" condition
   applies when traffic drops to zero.
2. Stop ingestion. Wait ~30s.
3. Heartbeat tick issues a `no-data` alert via the outbox — same
   canonical dispatch path as the real-time breach.

### 4. Flagged project — firing resolve

1. Trigger currently firing (breach path #2).
2. Stop the metric — traffic drops.
3. Within ~30s the heartbeat's resolve pass moves the alert to resolved
   and emits the resolve notification.

### 5. Dedup

1. Same project/trigger/threshold — fire twice in quick succession.
2. Only ONE notification. Outbox dedup on `(reactorName, dedupKey)`
   collapses the second.

### 6. Flag flip mid-flight

1. Trigger firing via cron on an un-flagged project.
2. Flip `release_es_graph_triggers_firing` ON.
3. Cron skips on the next tick; the new path takes over without a
   double-fire. The next `heartbeat` resolve handles the firing lifecycle
   from where cron left off.

## Regression traps — what to specifically re-verify

- **Outbox runtime attached.** Same as PR #4498 — no `outbox runtime
  attached` at boot means every graphEval enqueue silently fails. This PR
  extends the outbox setup path; `presets.ts` must call `attachOutbox()`
  after the outbox is built. Signature: reactor's `decide` returns
  enqueues, no `ReactorOutbox` row written, no dispatch.
- **Heartbeat lock TTL & shutdown wait.** Kill a worker mid-tick; within
  `max(intervalMs * 2, 30s)` the lock releases and the next worker picks
  up. `stop()` must await `inFlightTicks` — a `stop()` that returns
  immediately leaks dispatch past shutdown. Verify via orderly shutdown.
- **abortController mutable across start/stop.** Cycle `stop() →
  start()`. Registered entries' `decide(ctx)` gets a FRESH `AbortSignal`
  — the old one is gone. Regression = decides fire on an already-aborted
  signal and skip work.
- **`.withOutbox` reactor name matches its handler name.** Eval reactor's
  `definition.name` regressed to `"graphTriggerEvaluation:evaluation"` in
  a draft; the static pipeline builder threw at boot with "unknown outbox
  reactor name". Handler name is `"graphTriggerEvaluation"` — no
  `:evaluation` suffix.
- **Cron flag check is per-trigger's project.** The
  `release_es_graph_triggers_firing` check in
  `src/server/routes/cron.ts` (~line 253) resolves the flag once per
  distinct project and skips that project's triggers when flagged. If it
  regresses to project-global-off / trigger-global-on, un-flagged
  projects double-fire.
- **Case-insensitive `Alert:` prefix.** Rename a graph alert to `alert:
  cost spike`. Save. Row must read `Alert: cost spike`, not `Alert:
  alert: cost spike`. Covered by builder unit tests; the
  `/^\s*alert:\s*/i` regex was a P0 fix.
- **`graphEval` outbox stage doesn't fit the (trigger, trace) shape.**
  Graph evals have no traceId — they're per-trigger. `payload.ts` has a
  `graphEval` stage discriminator distinct from settle/cadence. A settle
  payload built with a graph-alert reactor's dedup key fails silently.
- **Single handler serves both wake sources.** `evaluateGraphTrigger` is
  the ONE dispatch handler whether the event pipeline or the heartbeat
  woke it. Two versions = the exact duplication ADR-039 prevents.

## Rollback plan

1. Flip `release_es_graph_triggers_firing` OFF for affected projects.
   Cron picks them up on the next 3-minute tick.
2. Pending `graphEval` outbox rows can drain safely — the handler is
   idempotent per `TriggerSent`.
3. If the heartbeat misbehaves (log spam, lock stuck), set the generated
   `es-<aggregate>-graphTriggerHeartbeat-<name>-killswitch` to `true` in
   the operator store. The scheduler skips that consumer's tick.
4. No schema removal, no data migration. Cron K8s job unchanged.

## Failure modes to alert on

- CloudWatch grep: `heartbeat leader lock acquisition failed` at
  sustained rate → Redis contention or lock never releasing.
- CloudWatch grep: `graphTriggerCron skipped project=<X>` where `<X>` is
  a project you did NOT flag → per-project flag check regressed.
- Sentry: `unknown outbox reactor name` at worker boot → reactor
  registration regressed. Worker won't accept traffic.
- CloudWatch grep: `no-data alert fired` more frequent than configured
  cadence → heartbeat firing more than once per `intervalMs`. Usually
  lock TTL / leader election.
- Grafana: cron dispatch count for flagged projects > 0 → double-fire,
  catastrophic.
- Sentry: `outbox runtime not attached` at boot → PR-4498 hoist regressed
  (again). This PR piggybacks on that wiring.
