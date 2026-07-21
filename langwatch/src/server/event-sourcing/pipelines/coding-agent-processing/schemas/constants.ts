/**
 * Type identifiers for the coding-agent pipeline (ADR-056).
 *
 * Taxonomy: `<provenance>.<domain>.<aggregate-type>.<identifier>` — the
 * aggregate is the SESSION, not the trace. Every event here is a contribution
 * INTO a session from one of the three OTLP signals.
 */

export const SPAN_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.span_facts_contributed" as const;
export const SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST =
  "2026-07-21" as const;

export const LOG_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.log_facts_contributed" as const;
export const LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST =
  "2026-07-21" as const;

export const METRIC_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.metric_facts_contributed" as const;
export const METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST =
  "2026-07-21" as const;

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
