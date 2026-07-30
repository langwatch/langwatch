/**
 * `coding-agent-processing` (`specs/coding-agent/session-aggregate.feature`).
 *
 * `coding_agent_session`, fed by three contribution commands bridged from
 * `trace`, `log` and `metric` — a bridge, not a subscription, because the
 * session id is none of their aggregate ids (ADR-098 §9). `codingAgentSession`
 * (fold) carries identity only, `codingAgentTraceSessions` (map) is the
 * `TraceId -> SessionId` seam, and `codingAgentSessionContributions` (map) is
 * the item-grain table every count is derived from at read time (ADR-103).
 */

export {
  type CodingAgentSessionAggregate,
  codingAgentSession,
  codingAgentSessionAggregateId,
} from "./aggregate";
export {
  CONTRIBUTION_SWEEP_INTERVAL_MS,
  CONTRIBUTION_SWEEP_NAME,
  type ContributionSweepDeps,
  type ContributionSweepMount,
  type ContributionSweepOutcome,
  createContributionSweepMount,
  runContributionSweep,
} from "./bridge/contributionSweep";
export type { CodingAgentDetectionPort } from "./bridge/detection.types";
export {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  createLogFactsBridge,
  createMetricFactsBridge,
  createSpanFactsBridge,
  type LogRecordReceivedEvent,
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  type MetricDataPointReceivedEvent,
  SPAN_RECEIVED_EVENT_TYPE,
  type SpanReceivedEvent,
} from "./bridge/dispatch";
export type { CodingAgentBridgeSubscriber } from "./bridge/subscriber.types";
export {
  type CodingAgentSessionContributionsRow,
  codingAgentSessionContributionsTable,
  createCodingAgentSessionContributionsStore,
  mapToSessionContribution,
} from "./contributions";
export {
  codingAgentContributionCommandGroupKey,
  codingAgentSessionContributionsGroupKey,
  codingAgentSessionGroupKey,
  codingAgentTraceSessionsGroupKey,
  renderCodingAgentSessionGroupKey,
} from "./groupKey";
export {
  assertCodingAgentProcessingMountsAreLegal,
  codingAgentSessionContributionsMount,
  codingAgentSessionMount,
  codingAgentTraceSessionsMount,
} from "./mount";
export {
  CODING_AGENT_PROCESSING_TYPE_STRING_SNAPSHOT,
  checkCodingAgentProcessingRatchet,
  currentCodingAgentProcessingTypeStrings,
} from "./ratchet";
export {
  type CodingAgentSessionContributionRecord,
  type CodingAgentSessionIdentityState,
  codingAgentSessionIdentityStateSchema,
  type ContributionFacts,
  type ContributionKind,
  contributionFactsSchema,
  contributionKindSchema,
  type IdentitySlot,
  identitySlotSchema,
  initCodingAgentSessionIdentityState,
  type LogFactsContribution,
  logFactsContributionSchema,
  type MetricFactsContribution,
  metricFactsContributionSchema,
  type SessionKeySource,
  sessionKeySourceSchema,
  SPARSE_IDENTITY_SLOTS,
  type SpanFactsContribution,
  type SparseIdentitySlot,
  spanFactsContributionSchema,
} from "./schema";
export {
  applyIdentity,
  applyIdentitySlot,
  applyStartedAtMs,
  resolveCodingAgentSessionId,
} from "./sessionIdentity";
export {
  type CodingAgentSessionsStoreArgs,
  createCodingAgentSessionsStore,
} from "./store";
export { type CodingAgentSessionsRow, codingAgentSessionsTable } from "./table";
export {
  CODING_AGENT_TRACE_SESSIONS_TABLE_NAME,
  type CodingAgentTraceSessionRecord,
  type CodingAgentTraceSessionsRow,
  type CodingAgentTraceSessionsStoreArgs,
  codingAgentTraceSessionsColumns,
  createCodingAgentTraceSessionsStore,
  mapToTraceSession,
} from "./traceSessions";
