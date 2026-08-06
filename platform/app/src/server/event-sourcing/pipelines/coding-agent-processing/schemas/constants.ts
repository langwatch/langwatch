/**
 * Type identifiers for the coding-agent pipeline (ADR-056).
 *
 * Taxonomy: `<provenance>.<domain>.<aggregate-type>.<identifier>` — the
 * aggregate is the SESSION, not the trace. Every event here is a contribution
 * INTO a session from one of the three OTLP signals.
 */

export const SPAN_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.span_facts_contributed";
export const SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST = "2026-07-21";

/**
 * The staged twin of a matched `span_received` for `codingAgentSpanFactsDispatch`
 * — the span's facts, already lifted, carried ON the job (ADR-069's bounded
 * derivation amendment). It replaces the `span_referenced` claim-check once R2
 * flips the producer — this build reads it and stages nothing new — because that
 * claim-check's read-back raced the sibling spanStorage write and parked 22
 * groups in `:blocked` on 2026-08-05.
 *
 * This is a bounded derivation, not a payload: `data` is
 * `spanFactsContributionSchema`, whose facts come from the closed
 * `CODING_AGENT_CONTRIBUTION_KEYS` list and hold scalars only, so the staged
 * size is bounded by that list rather than by the span it came from. Content
 * stays in `stored_spans`.
 *
 * Like `span_referenced` it is NEVER appended to the event log — it exists only
 * between the routing seam and the subscriber — which is why it is absent from
 * CODING_AGENT_PROCESSING_EVENT_TYPES.
 *
 * The versions array is load-bearing: a version this build does not know fails
 * loudly into the queue's retry rather than half-parsing. Bump and append on any
 * incompatible change to the lifted shape.
 */
export const SPAN_FACTS_LIFTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.span_facts_lifted";
export const SPAN_FACTS_LIFTED_EVENT_VERSION_LATEST = "2026-08-05";

export const SPAN_FACTS_LIFTED_EVENT_VERSIONS = [
  SPAN_FACTS_LIFTED_EVENT_VERSION_LATEST,
] as const;

export const LOG_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.log_facts_contributed";
export const LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST = "2026-07-21";

export const METRIC_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.metric_facts_contributed";
export const METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST = "2026-07-21";

export const CODING_AGENT_PROCESSING_EVENT_TYPES = [
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
] as const;

export const CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE =
  "lw.obs.coding_agent_session.contribute_span_facts" as const;
export const CONTRIBUTE_LOG_FACTS_COMMAND_TYPE =
  "lw.obs.coding_agent_session.contribute_log_facts" as const;
export const CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE =
  "lw.obs.coding_agent_session.contribute_metric_facts" as const;

export const CODING_AGENT_PROCESSING_COMMAND_TYPES = [
  CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
  CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
  CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE,
] as const;

/**
 * How many same-group events the pipeline's map projections persist through
 * one `bulkAppend` call when a group is backed up. MAP projections default
 * to 1 — one append per queued event (unlike folds, which the router
 * coalesces at 500 by default) — a linear per-item drain cost whose
 * constant is a full queue job, the drain floor these maps showed during
 * the 2026-07-31 backlog (one-event-per-job at ~90 busy fleet slots). 256
 * matches the log/metric map ceilings
 * (`LOG_MAP_COALESCE_MAX_BATCH`, `METRIC_MAP_COALESCE_MAX_BATCH`): both
 * stores append into ClickHouse via `insertMany`, so the batch lands as one
 * insert either way — the ceiling only bounds payload size per dispatch.
 * Unlike `CODING_AGENT_SESSION_COALESCE_MAX_BATCH` (128), no per-row
 * watermark is persisted by these maps, so the session fold's tighter bound
 * does not apply.
 */
export const CODING_AGENT_MAP_COALESCE_MAX_BATCH = 256;

/**
 * Append-coalescing bound for the three contribution commands (ADR-066 pillar 2).
 *
 * Every contribution is keyed on its SESSION, so one session is one queue group
 * and a long agent run parks its whole transcript behind a single lane that
 * drains one job — one tiny event_log insert — per dispatch. Folding the group's
 * queued contributions into a single multi-row append is what takes that lane
 * off the per-item write path.
 *
 * 256 matches the sibling record commands
 * (`LOG_COMMAND_COALESCE_MAX_BATCH`, `METRIC_COMMAND_COALESCE_MAX_BATCH`) and
 * this pipeline's own map ceiling: a contribution carries lifted scalar facts,
 * the same payload class, and the drain's byte budget backs the count up.
 * `CODING_AGENT_SESSION_COALESCE_MAX_BATCH` (128) is deliberately NOT the
 * reference — that bound exists because the session fold persists its
 * applied-event-id watermark into its row, which is a constraint on the fold
 * stage, not on this append.
 *
 * Why the session key is NOT sharded, though sharding is what would give one
 * session parallel lanes: a session's contributions are not interchangeable.
 * `foldModelCall` derives three things from the ORDER model calls arrive in —
 * `previousCallContextTokens`, which the next call is compared against to decide
 * whether it rebuilt its cache; `finalRequestId`, which is last-call-wins; and
 * `stopReason`/`truncated`, which are only the last call's. A logs-only agent's
 * API_REQUEST records fold through exactly that path, so spreading one session's
 * log contributions across shards would systematically reorder them and corrupt
 * all three. The fold's `refoldOnOutOfOrder: false` is not permission to
 * reorder: it accepts the occasional late event folding in place, which is very
 * different from introducing reordering by design. Coalescing needs none of
 * that — it changes how many contributions share an insert, never their order.
 */
export const CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH = 256;
