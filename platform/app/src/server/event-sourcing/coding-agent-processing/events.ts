import {
  logFactsContributionSchema,
  metricFactsContributionSchema,
  spanFactsContributionSchema,
} from "./schema";

/**
 * `prefix` keeps every derived type string byte-equal to what's already in
 * `event_log` (`lw.obs.coding_agent_session.*`).
 */
export const CODING_AGENT_SESSION_PIPELINE_NAME = "coding_agent_session";
export const CODING_AGENT_SESSION_PIPELINE_PREFIX = "lw.obs";

/**
 * One aggregate fed by three contribution commands bridged from `trace`,
 * `log` and `metric` — a bridge, not a subscription, because the session id
 * is none of their aggregate ids (ADR-098 §9, ADR-105 consequences).
 */
export const codingAgentSessionEvents = {
  spanFactsContributed: spanFactsContributionSchema,
  logFactsContributed: logFactsContributionSchema,
  metricFactsContributed: metricFactsContributionSchema,
} as const;
