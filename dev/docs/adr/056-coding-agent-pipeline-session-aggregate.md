# ADR-056: Coding-agent pipeline with a session aggregate

**Date:** 2026-07-21

**Status:** Proposed

**Store corrected by:** [ADR-066](./066-projection-clickhouse-cached-store.md) — the session-aggregate store must read its full state back from ClickHouse. The no-read-back store (`get()` returns null, forcing an `event_log` refold on every cache miss and out-of-order delivery) caused a production outage and is forbidden. The pipeline shape and session-key decisions in this ADR stand.

## Context

Coding agents (Claude Code, opencode, Codex, Gemini CLI, Copilot) emit three
OTLP signals, and each correlates differently. These facts are verified
empirically (live telemetry + agent source), not assumed:

- **Spans** carry real trace context. One session's spans share one wire
  `TraceId` per interaction; the session key rides as an attribute
  (`session.id` on Claude Code, `gen_ai.conversation.id` on opencode — the
  *values* are identical across signals, only the spelling differs).
- **Logs** carry content (prompts, replies, tool decisions) plus lifecycle
  events. The canonical log pipeline (ADR-055) stamps every record with a
  `CorrelationTraceId` — the wire id when present, otherwise a deterministic
  hash of the session key (`CorrelationSource: synthesized`). A tool the human
  *denied* never ran, so it exists **only** as a log.
- **Metrics** carry **no trace context at all**: an OTLP datapoint has no
  trace/span field, only exemplars could carry one, and neither the OTel Rust
  nor JS SDK implements exemplars. Measured on live data: 0 of 356
  coding-agent points carried a trace id; 356 of 356 carried `session.id`.
  Metrics are also the *only* source of lines-of-code, commits, PRs, edit
  accept/reject and active-time — and some sessions emit **only metrics**
  (measured: 5 metric sessions vs 3 span sessions in the same window; Codex
  and Copilot metrics are fleet-level by design upstream).

PR #5708 built the first coding-agent session view as a **fold inside
`trace-processing`, keyed by `TraceId`**. That shipped real value (Session
tab, Terminal transcript, five-agent vocabulary normalization, several silent
bug fixes), but the trace-first shape forces workarounds that all share one
root cause — *the model has no session aggregate, only a trace aggregate*:

1. The session row is keyed by `TraceId`, so a session spanning traces
   (sub-agent `claude -p` spawns) scatters across rows, and a metric-only
   session cannot exist at all.
2. Log facts are re-routed *into* the trace pipeline
   (`RecordLogContributionCommand`) so a trace-keyed fold can see them —
   re-coupling the log pipeline to traces right after ADR-055 separated them.
3. Metrics structurally cannot feed the fold, so the read path re-scans
   `metric_time_rollups` by `session.id` on every session-view open and
   overlays the result.
4. Context-less logs must first *become* a trace (synthesized trace ids) to
   participate — everything must be a trace before it can be seen.
5. `trace-processing` already registers 13 reactors; coding-agent concerns
   metastasizing there deepens a side-effect sprawl we already regret.

## Decision

We will build a dedicated **`coding-agent-processing` pipeline** whose
aggregate is the **session**, not the trace.

1. **Aggregate.** `aggregateType: "coding_agent_session"`, aggregate id =
   the tenant-scoped provider session key (`session.id` /
   `gen_ai.conversation.id`, normalized). A coding-agent trace with no
   session key degrades to `traceId` as its session key (a one-trace
   session), so nothing is dropped.

2. **Contributions in, from every signal.** Each source pipeline dispatches a
   session-keyed contribution command into this pipeline — the same durable
   cross-pipeline bridge ADR-055 established for `log_contributed`, re-aimed:
   - `contributeSpanFacts` — from span ingestion (tool/model-call facts).
   - `contributeLogFacts` — from log-processing (the lifted scalar
     vocabulary; content never rides, lengths/ids/counters only).
   - `contributeMetricFacts` — from metric-processing (**net-new**: the
     converged per-series totals for the session's series).
   The trace pipeline's coding-agent fold and its log re-routing are retired;
   the trace becomes a *contribution and a drill-down*, not the spine.

3. **Consumption primitives: subscribers, projections, one process manager.
   No reactors.** Fan-in is `withEventSubscriber`; read models are
   projections; lifecycle (session finalization, late-contribution reopen) is
   a named process manager per ADR-052. Origin gating is a predicate inside
   the subscriber, not a gate reactor.

4. **Projections.**
   - `coding_agent_sessions` — the session row (fold), **keyed by
     `SessionId`**, carrying `TraceIds` as a bounded array. Columns and
     bounded-by-design invariants carry over from PR #5708's DDL (every
     column a scalar, bounded array, or low-cardinality map; text measured,
     never carried).
   - `coding_agent_trace_sessions` — a slim map projection
     `(TenantId, TraceId) → SessionId`, so the trace drawer resolves its
     session with two keyed seeks instead of an array scan.
   - `session_metric_series` — converged per-series metric totals keyed
     `(TenantId, SessionId, SeriesId)`.

5. **Metric idempotency rule.** Delta counters + an accumulating engine
   double-count on replay, and this substrate replays. Therefore the metric
   projection **stores converged values and re-writes them
   (`ReplacingMergeTree`, last-write-wins per series); it never increments on
   insert.** The per-session read is `SUM(...) GROUP BY` across the session's
   deduplicated series. A `SummingMergeTree` fed raw points is explicitly
   rejected — there is no point-level dedup once re-keyed to session.

6. **Two decoupled surfaces.** Signals surface at their own grain:
   - **Session surfaces** (session/enrichment tab in the trace drawer,
     personal-workspace usage) read the session aggregate by
     `SessionId` / `UserId`. They work for metric-only sessions.
   - **Trace enrichment** (Terminal transcript, log accordions,
     read-time span content enrichment, exemplar-correlated metrics like
     TTFT) reads by `CorrelationTraceId` and does **not** depend on the
     session aggregate. It works for any trace, coding-agent or not.
   Neither surface can break the other.

7. **Provider vocabulary lives here.** The per-agent adapters (token-bucket
   spelling, non-additive buckets like Codex `total` / Gemini `tool`, MCP
   name parsing from tool names) are single-sourced in this pipeline's
   normalization services. Nothing agent-specific remains in
   `trace-processing`.

8. **Synthesis stays, generically.** Logs-only sources (a logs exporter with
   no traces exporter) still get a synthesized `CorrelationTraceId` and the
   "Grouped by LangWatch" badge — that is honest labeling, not scaffolding.
   The per-agent `claude_synthesized` / `codex_synthesized` enum values
   collapse to one generic `synthesized`; the provider already rides
   `ProviderKind`, and the fold derives `derived_from` from it. Old values
   remain parse-accepted (events already stored on main), never re-written.

## Rationale / Trade-offs

**Why a session aggregate instead of fixing the trace-keyed fold in place:**
every symptom in the context list is the same missing concept. Re-keying the
fold while leaving it inside `trace-processing` would fix (1) but leave logs
re-routed through traces, metrics read-joined, and the vocabulary embedded in
the trace pipeline. A session aggregate makes metrics a first-class
contributor — which is the only way metric-only sessions can exist — and
returns `trace-processing` to processing traces.

**Why no reactors:** reactors are unnamed side effects triggered by storage
events; thirteen of them on the trace pipeline is how the current tangle
grew. Subscribers make consumption explicit and replay-visible; process
managers make multi-step lifecycle a named, testable saga (ADR-052).
Everything this pipeline needs maps onto those two plus projections.

**Why engine-fold for metrics, app-fold for spans/logs:** span/log facts are
*derived and non-summable* (step sequencing, cache-rebuild detection, error
classes) — they need the app-side fold. Metric facts are sums/counts —
exactly what `ReplacingMergeTree` + `GROUP BY` do natively, with replay
safety inherited from the converged-value rule rather than bespoke state.

**Costs accepted:** one more pipeline to operate; a session row that carries
a `TraceIds` array plus a helper map projection instead of a single trace
key; a migration re-cut (the old `00051` never merged, so numbering is
clean); the cutover retires PR #5708 rather than rebasing it — its UI and
derivation logic port over per the plan's manifest, its pipeline shape does
not.

**Dependency:** metric contributions hinge on `session.id` riding datapoint
attributes (`OTEL_METRICS_INCLUDE_SESSION_ID`, upstream default `true`; the
installer keeps it on). When absent, the pipeline degrades gracefully: spans
and logs still materialize the session; fleet-level metrics stay in the
canonical metric tables.

## Consequences

- Metric-only sessions become visible everywhere sessions surface; LOC,
  commits, PRs, edit decisions and active-time come from their authoritative
  source instead of sitting unread in storage.
- Multi-trace sessions unify under one row; the trace drawer's session tab
  resolves through `coding_agent_trace_sessions`.
- The session-view read drops its per-open rollup scan.
- `trace-processing` loses the coding-agent fold, the legacy
  `claudeCodeSpanSync` reactor and log-to-span converter (still live on
  main today), and their spec; log-only installs stop getting synthesized
  tool spans and need `langwatch claude` re-run for real spans — a release
  note, as PR #5708 already documented.
- PR #5708 is superseded and closed; its branch is deleted (this also
  retires the credential blob still reachable in that branch's history —
  the password is already rotated).
- Future agents (or any customer app that sets `session.id`) onboard by
  writing one vocabulary adapter; the aggregate, projections and surfaces
  are already generic.

## References

- Related ADRs: ADR-052 (process-manager substrate), ADR-055 (canonical OTLP
  metric and log pipelines), PR #5708's draft ADR-041 (coding-agent session
  projection — superseded by this document).
- Specs: `specs/coding-agent/session-aggregate.feature`,
  `specs/coding-agent/personal-usage.feature`.
- Build plan + port manifest: `dev/docs/coding-agent-pipeline-plan.md`.
- Claude Code telemetry reference:
  https://code.claude.com/docs/en/monitoring-usage
