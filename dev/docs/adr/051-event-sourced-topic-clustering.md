# ADR-051: Event-sourced topic clustering scheduling via the process manager

**Date:** 2026-07-17

**Status:** Accepted

**Extends:** ADR-049's process-manager substrate to a second domain.
ADR-049 deferred generalization "until a second domain proves the same
shape" — topic clustering is that domain.

## Context

Topic clustering's *write* path is already event-sourced: `storeResults`
emits one `AssignTopic` command per assigned trace, and the
`TopicAssignedEvent` fold projections stamp `TopicId`/`SubTopicId` onto
ClickHouse `trace_summaries` and `trace_analytics`
(see [specs/topic-clustering/trace-assignment.feature](../../../specs/topic-clustering/trace-assignment.feature)).

Its *scheduling and orchestration*, however, is the platform's last
substantial BullMQ holdout after ADR-014:

- A Kubernetes CronJob hits `/api/cron/schedule_topic_clustering`, which
  fans out one BullMQ job per eligible project with a delay of up to 24
  hours (a sha256 hash of the project id was meant to spread load across
  the day; it does not — see the wake slot below).
- A standalone BullMQ worker (concurrency 3) runs
  `clusterTopicsForProject`, and pagination through the trace backlog
  works by re-enqueueing a job carrying a `search_after` cursor in its
  payload.
- The manual trigger on the settings page enqueues the same job with
  delay 0 — and, because the cadence gate still applies, can silently do
  nothing, with no way for the user to see why.

The problems this creates:

- **Schedule state is invisible and volatile.** The next run time for a
  project exists only as a delayed job inside Redis. A Redis flush loses
  a day's schedule; nobody can query "when does project X cluster next?"
- **Progress lives in job payloads.** The pagination cursor exists only
  in the not-yet-processed queue job. A crash mid-backlog loses the
  cursor's durability guarantees to BullMQ retry semantics.
- **A parallel infrastructure lane.** The BullMQ queue, worker boot hook,
  HTTP cron endpoint, and Helm CronJob entry are a second scheduling
  stack maintained alongside the event-sourcing platform.

ADR-049 built the pieces this needs: `ProcessManagerService` with a pure
`evolve(previousState, input) → { state, nextWakeAt, intents }` contract,
Postgres `ProcessManagerInstance`/`Inbox`/`Outbox` tables with atomic
commit and lease-fenced at-least-once intent dispatch, and event-only
subscribers on the pipeline builder. One piece is unproven: durable
wake-ups. `ProcessStore.findDueWakes` and
`ProcessManagerService.handleWake` exist, but no production code calls
them — the Langy pilot deliberately schedules no wakes.

See [specs/topic-clustering/event-sourced-scheduling.feature](../../../specs/topic-clustering/event-sourced-scheduling.feature)
for the behavioural contract this decision supports.

## Decision

Topic clustering's scheduling moves onto the ADR-049 substrate: a small
`topic-clustering` pipeline for durable events, a
`TopicClusteringProcess` per project that owns the timer and run
lifecycle, a lease-fenced outbox effect that runs the existing clustering
code, and a new generic wake worker that makes `nextWakeAt` real.

```text
ProcessWakeWorker tick (worker role)
      │ findDueWakes → handleWake (revision-fenced)
      ▼
TopicClusteringProcess.evolve  ──────  pure; owns timer + run lifecycle
      │ commit: state + nextWakeAt + intents (one Postgres tx)
      ▼
ProcessManagerOutbox ── run:<slot> intent, leased FOR UPDATE SKIP LOCKED
      │
      ▼
clustering effect handler ── clusterTopicsForProject (gates + langevals)
      │ dispatch recordClusteringRunCompleted / …Failed command
      ▼
ClickHouse event_log ── requested / run_completed / run_failed events
      │ GroupQueue envelope (per-project FIFO)
      ▼
event subscriber ── feeds committed events back into the process
```

### 1. A `topic-clustering` pipeline: commands, events, one status projection

Aggregate type `topic_clustering`, aggregate id = project id. Three
`defineCommand` declarations:

| Command                        | Event                                  |
| ------------------------------ | -------------------------------------- |
| `requestClustering`            | `lw.obs.topic_clustering.requested`    |
| `recordClusteringRunCompleted` | `lw.obs.topic_clustering.run_completed`|
| `recordClusteringRunFailed`    | `lw.obs.topic_clustering.run_failed`   |

`requested` carries a trigger (`manual` | `bootstrap`). `run_completed`
carries the run's facts: mode (batch/incremental), traces processed,
topics/subtopics written, a skip reason when a gate declined the run, and
the `nextSearchAfter` cursor when a full page indicates more backlog.
ClickHouse `event_log` remains the event authority; the GroupQueue
envelope is staged only after the append succeeds (ADR-049 §1).

The pipeline registers **one slim Postgres projection** —
`TopicClusteringRunProjection`, one row per project: last run at,
outcome (completed / skipped / failed), mode, skip reason, error, and
run counts, with the standard `(AcceptedAt, EventId)` cursor guard.
Folded from `run_completed`/`run_failed` on the same Postgres
operational-projection path Langy's conversation projection uses
(ADR-049 §1); rebuildable by replay. This is the read model the status
surface queries — decisions read process state, screens read
projections. Analytical needs are already served by the existing `Cost`
rows and trace projections.

### 2. `TopicClusteringProcess` owns the timer and the run lifecycle

Keyed `("topicClustering", projectId, projectId)`. Compact JSON state
holding only what decisions need: the current run (slot date, cursor,
pages so far) and the enablement marker. Last-run facts for the UI live
in the status projection, not here — the process state stays private
decision memory. No prompts, trace content, or credentials.

- **On wake** — emit a `run:<yyyymmdd>` intent and schedule the next
  wake at the project's next daily slot, a stable minute of the UTC day
  derived from a sha256 of the project id. The timer is now a durable
  Postgres column instead of a delayed Redis job.

  The legacy spread this replaces did not work: it read the digest with
  `parseInt(hex, 16)`, which overflows `Number.MAX_SAFE_INTEGER` and
  rounds to a multiple of 2^203, so `% 24` and `% 60` both collapsed and
  the entire fleet fell into 15 slots at hours 00, 08 and 16 — three
  daily spikes, measured, not the claimed spread. Under BullMQ that was
  one cron burst absorbed by a queue; against the wake worker's fixed
  drain rate it is a genuine thundering herd. The slot is now taken as a
  single remainder over the day's 1440 minutes (`% 24` and `% 60` share
  a factor, so pairing them would give 120 combinations, not 1440).
  Deploying this moves every project's slot once; a daily job simply
  gets one longer or shorter interval, and the slot is stable after.
- **On `requested` (manual)** — emit a `run:manual:<occurredAt>` intent
  immediately. Manual runs do not disturb the daily schedule.
- **On `requested` (bootstrap)** — initialize state and schedule the
  first wake; no intent. Idempotent, so the backfill task can re-send it.
- **On `run_completed` with a cursor** — emit the continuation intent
  for the next page. The cursor is process state: a crash mid-backlog
  resumes from the last committed page, not from scratch.
- **On `run_completed` (final) / `run_failed`** — record the outcome and
  stand by until the next wake.

Intent message keys (`run:<yyyymmdd>`, `run:<yyyymmdd>:page-<n>`,
`run:manual:<ts>`) are the idempotency identities: a duplicate event
delivery or a replayed command cannot double-insert an intent.

### 3. Run/skip policy stays in the effect handler

`clusterTopicsForProject` keeps all three gates: mode selection (topics
exist AND ≥1200 assigned → incremental), the 2/3/7-day cadence window,
and work detection (unassigned traces exist). The process never
second-guesses them; it learns the outcome from `run_completed` and
records it.

**Rejected: moving the cadence gate into `evolve()`.** Mode selection
and work detection depend on live trace counts the process cannot see
(traces are a different aggregate; subscribing the process to trace
events is a non-starter at trace volume). Purity is therefore
structurally capped at a *split* policy — evolve() saying "not in a skip
window" while the effect still skips for its own reasons. One policy
home on live data beats two half-policies; the saved daily count query
is negligible. Revisitable once `run_completed` facts have proven
reliable in production.

### 4. The clustering effect: parity retry posture, generous lease

The outbox intent handler calls `clusterTopicsForProject` — changed to
*return* its outcome (mode, counts, skip reason, next cursor) instead of
enqueueing its own next page — then dispatches
`recordClusteringRunCompleted`/`…Failed`. Dispatch posture matches the
BullMQ behaviour being replaced:

- `maxAttempts: 3`, then the message retires as dead and a
  `recordClusteringRunFailed` command records the failure in durable
  state (the settings page shows it; the old path buried this in a
  BullMQ failed-jobs list).
- In-flight clustering dispatches are bounded to ~3 so langevals sees
  the same load profile as the old worker's concurrency cap.
- The lease must outlive the slowest realistic langevals batch call
  (minutes) — sized like Langy's `LANGY_OUTBOX_LEASE_DURATION_MS`
  precedent, not the generic 30s default.

### 5. A generic `ProcessWakeWorker` completes the substrate

A small poll loop beside `ProcessOutboxWorker` in
`event-sourcing/process-manager/`: periodically `findDueWakes` →
`handleWake` for each. No leader election is needed — `handleWake`
commits with `expectedRevision`, so when two workers race the same wake,
exactly one commit wins and the loser is a no-op (`staleWake` /
`revisionConflict`). Worker-role only, composed and stopped by the
pipeline registry alongside the outbox worker. Topic clustering is the
first production consumer of the wake path; Langy can adopt it later
without new infrastructure.

### 6. Bootstrap, backfill, and legacy removal

- The trace pipeline's `projectMetadata` reactor dispatches
  `requestClustering` (bootstrap) on **every** real ingest, not only when
  `firstMessage` flips. This is deliberately **level-triggered**: an edge
  that is missed — a failed bootstrap, a project predating the feature, a
  deploy gap — is missed forever, and leaves a project with no `nextWakeAt`
  and nothing to notice. Re-asserting is safe because a bootstrap request
  cannot start a run or move a wake (`nextDailySlot` is anchored to the
  project's hash slot, not relative to now), and affordable because the
  injected implementation is rate-limited per project
  (`createRateLimitedBootstrap`, one commit per project per claim window).
- `seedClusteringSchedules` (`app-layer/topic-clustering/
  seedClusteringSchedules.ts`) seeds processes for existing eligible
  projects (`firstMessage: true`). Safe to re-run: bootstrap is idempotent.
- **It covers dormant projects only.** Any project that ingests re-asserts
  its own schedule, so its remaining job is projects that have ingested
  nothing since the upgrade. It runs as a one-time pass on worker boot —
  not a Helm hook Job — Redis-elected across replicas when available and
  idempotent regardless, with a permanent done-marker once a pass finds
  nothing left to schedule so a signup after the cutover never pays for a
  scan. A worker boot never races app migrations the way a Helm hook did
  (workers only start after boot), so no schema wait is needed. Whatever
  it skips is picked up by the next boot, a manual run, or the project's
  own next trace.
- Only a `manual` request can be reported as "in flight". A bootstrap
  request starts no run, so counting one would render "Running" for a
  project where nothing runs — and, being re-asserted on ingest, would
  latch permanently for every active project.
- The settings-page manual trigger dispatches `requestClustering`
  (manual) via tRPC instead of enqueueing a BullMQ job. The CLI task
  (`runTopicClustering`) calls the core function directly and loops
  pages locally.
- Deleted outright: `topicClusteringQueue.ts`,
  `topicClusteringWorker.ts`, the `/api/cron/schedule_topic_clustering`
  route, the Helm CronJob entry, and the `startWorkers` boot hook.
  In-flight delayed jobs die with the queue; the backfill immediately
  re-establishes every project's schedule as a durable wake.

### 7. A small status surface on the settings page

The topic clustering settings page shows the last run (time, mode,
outcome, skip/fail reason) and the next scheduled run. Served by a
service (route → service layering per ADR-019) that reads the
`TopicClusteringRunProjection` row for the run facts and the
`ProcessManagerInstance.nextWakeAt` column for the next run — the
process is the sole authority on scheduling intent, which is not an
event-derived fact a projection could fold. The page keeps its manual
trigger button. This turns the old "click trigger, nothing visibly
happens" into "skipped: clustered 2 days ago".

### 8. Failures are classified; raw errors never reach the product

The effect classifies a final-attempt failure before recording it
(`classifyClusteringError`), grounded in the failure classes production
Loki actually shows: `model_not_configured` (the dominant one — thrown
as `No model configured for "analytics.topic_clustering_llm" …`),
`model_provider_auth`, `model_provider_quota` — all user-actionable —
versus `clustering_service` (langevals-side) and `internal`, which are
ours. The `run_failed` event and projection carry the code, the
user-actionable flag, and the full error text for operators; the status
service NEVER returns the raw text — not even for user-actionable
failures. The raw text is a provider/langevals response body (Python
tracebacks, internal hostnames, echoed key prefixes), and gating its
release on a classifier means one mis-scoped pattern becomes a
disclosure. `lastRunErrorCode` is the whole contract with the UI: the
settings page maps actionable codes to fixed guidance copy ("set a
default model in Settings → Model Providers") and internal ones to
"failed on our side, retries automatically" with no detail.

**Deferred (own spec, follow-up):** a stackable home-notice surface and
an opt-out email (default off) for user-actionable clustering failures.
The classification here is their data source; nothing in this ADR blocks
them.

### 9. Code home and identifiers

The whole domain lives in `app-layer/topic-clustering/` (clustering
core, process manager, repositories, status service) — the legacy
`server/topicClustering/` module is gone. New row identifiers use KSUIDs
(`topicrun_…`) per platform convention, not nanoid.

## Implementation and validation

Acceptance gates:

- ClickHouse `event_log` stays the sole event authority; envelopes stage
  only after a successful append; the hot path never re-reads ClickHouse.
- All three run gates behave identically to the BullMQ path (parity is
  the migration's correctness bar — same skip windows, same mode
  selection, same page size and cursor semantics).
- A duplicate event delivery or duplicate command cannot double-run a
  slot or double-insert an intent (inbox + messageKey uniqueness).
- A worker restart recovers due wakes and pending intents from Postgres
  alone; a crash mid-backlog resumes from the committed cursor.
- A stale wake (process advanced since scheduling) stands down without
  side effects.
- Effect failures retry at most 3 times, then land as a durable, visible
  failed outcome.
- Ordinary replay rebuilds the status projection (and, in a disaster,
  process state) without dispatching intents, running effects, or
  appending new events — replay reads history, only commands write it
  (ADR-049's replay contract). A schedule gap after recovery self-heals:
  the next daily wake finds the backlog via live work detection.
- No BullMQ queue, worker, cron route, or CronJob entry remains for
  topic clustering.

## Rationale / Trade-offs

The process manager is the right home because topic clustering *is* a
long-running per-project workflow: a recurring timer, a multi-step
paginated run, retries, and operator-visible outcomes. Modelling it as
(timer → intent → effect → event → state) makes every piece durable,
inspectable, and idempotent — properties the delayed-job encoding only
approximated.

Costs accepted: Postgres rows and outbox churn for a batch feature that
ran fine on a queue (bounded: one wake, a handful of intents, and a few
events per project per day); and the wake worker is new substrate code —
though it is small, generic, revision-fenced by design, and closes the
last unproven gap in ADR-049's contract.
