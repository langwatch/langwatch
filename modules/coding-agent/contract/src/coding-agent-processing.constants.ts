/**
 * Type identifiers for the coding-agent pipeline (ADR-056). Taxonomy:
 * `<provenance>.<domain>.<aggregate-type>.<identifier>` — the aggregate is
 * the SESSION, not the trace; every event is a contribution into one.
 */

export const SPAN_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.span_facts_contributed";
export const SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST = "2026-07-21";

// Job payload staging for span facts contributions (ADR-069); content is
// bounded by CODING_AGENT_CONTRIBUTION_KEYS and versions are load-bearing.
export const SPAN_FACTS_LIFTED_PAYLOAD_TYPE = "lw.obs.coding_agent_session.span_facts_lifted";
export const SPAN_FACTS_LIFTED_PAYLOAD_VERSION_LATEST = "2026-08-05";

export const SPAN_FACTS_LIFTED_PAYLOAD_VERSIONS = [
  SPAN_FACTS_LIFTED_PAYLOAD_VERSION_LATEST,
] as const;

export const LOG_FACTS_CONTRIBUTED_EVENT_TYPE = "lw.obs.coding_agent_session.log_facts_contributed";
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

// Coalesce batch for map projections; matches log/metric map ceilings for
// one ClickHouse insert per dispatch.
export const CODING_AGENT_MAP_COALESCE_MAX_BATCH = 256;

/**
 * Contribution append bound from ADR-066, matching sibling log/metric/map
 * commands since all carry bounded scalar facts. Not sharded by session key:
 * model-call order determines cache rebuilds, stopReason and truncation.
 */
export const CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH = 256;
