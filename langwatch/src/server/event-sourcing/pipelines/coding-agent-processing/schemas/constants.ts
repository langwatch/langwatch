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
  "lw.obs.coding_agent_session.contribute_span_facts";
export const CONTRIBUTE_LOG_FACTS_COMMAND_TYPE =
  "lw.obs.coding_agent_session.contribute_log_facts";
export const CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE =
  "lw.obs.coding_agent_session.contribute_metric_facts";

export const CODING_AGENT_PROCESSING_COMMAND_TYPES = [
  CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
  CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
  CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE,
] as const;

/**
 * How many same-group events the pipeline's map projections persist through
 * one `bulkAppend` call when a group is backed up. MAP projections default
 * to 1 — one append per queued event (unlike folds, which the router
 * coalesces at 500 by default) — which is the O(n²) drain pattern these
 * maps showed during the 2026-07-31 backlog (one-event-per-job at ~90 busy
 * fleet slots). 256 matches the log/metric map ceilings
 * (`LOG_MAP_COALESCE_MAX_BATCH`, `METRIC_MAP_COALESCE_MAX_BATCH`): both
 * stores append into ClickHouse via `insertMany`, so the batch lands as one
 * insert either way — the ceiling only bounds payload size per dispatch.
 * Unlike `CODING_AGENT_SESSION_COALESCE_MAX_BATCH` (128), no per-row
 * watermark is persisted by these maps, so the session fold's tighter bound
 * does not apply.
 */
export const CODING_AGENT_MAP_COALESCE_MAX_BATCH = 256;
