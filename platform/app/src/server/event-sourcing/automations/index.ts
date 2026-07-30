/**
 * The `automations` pipeline (ADR-098, ADR-100, ADR-105) — a process-manager
 * substrate: a post-fold `triggerMatch` subscriber feeds matched traces onto
 * the `trigger` aggregate, and the `triggerSettlement` process manager turns
 * settled activity into dispatched notifications and persisted rows.
 *
 * Rewritten onto `@langwatch/event-sourcing` and `@langwatch/clickhouse`
 * against `langwatch/src/server/event-sourcing.old/pipelines/automations/`
 * as read-only reference. See `pipeline.ts` for the full topology and its
 * known gaps (no process-manager executor, no subscriber router, no
 * pipeline mount builder yet — all three are named core the package has not
 * shipped).
 */
export { createAutomationsPipeline } from "./pipeline";
export type { AutomationsPipeline, AutomationsPipelineDeps } from "./pipeline";

export { triggerAggregate } from "./aggregate";
export type {
  MatchRecordedData,
  TriggerActionClass,
  TriggerAggregate,
  TriggerAggregateState,
} from "./aggregate";

export { settleWindowBucket } from "./settleWindow";

export {
  GLOBAL_TENANT,
  recordMatchGroupKey,
  renderRecordMatchGroupKey,
  renderSingletonProcessManagerGroupKey,
  renderTriggerSettlementGroupKey,
  singletonProcessManagerGroupKey,
  triggerSettlementGroupKey,
} from "./groupKeys";

export { TerminalDispatchError, isTerminalDispatchError } from "./dispatchError";

export { defineProcessManager } from "./process-managers/defineProcessManager";
export type {
  IntentContext,
  IntentHandler,
  ProcessManagerDefinition,
} from "./process-managers/defineProcessManager";

export {
  TRIGGER_SETTLEMENT_PROCESS_NAME,
  addPending,
  digestBatchKey,
  drainDue,
  settleBoundary,
  triggerSettlementDefinition,
} from "./process-managers/triggerSettlement";
export type { OverflowFlush } from "./process-managers/triggerSettlement";
export type { TriggerDispatchPorts } from "./process-managers/triggerSettlement.dispatchPorts";
export {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
} from "./process-managers/triggerSettlement.intentHandlers";
export type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
  PendingMatch,
  TriggerSettlementState,
} from "./process-managers/triggerSettlement.types";
export { MAX_PENDING_MATCHES } from "./process-managers/triggerSettlement.types";

export {
  GRAPH_ALERT_SWEEP_INTERVAL_MS,
  GRAPH_ALERT_SWEEP_PROCESS_NAME,
  createEvaluateGraphHandler,
  graphAlertSweepDefinition,
} from "./process-managers/graphAlertSweep";
export type {
  GraphAlertSweepCandidate,
  GraphAlertSweepPorts,
  GraphAlertSweepState,
} from "./process-managers/graphAlertSweep";

export {
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  createPruneHandler,
  webhookDeliveryPruneDefinition,
} from "./process-managers/webhookDeliveryPrune";
export type {
  WebhookDeliveryPrunePorts,
  WebhookDeliveryPruneState,
} from "./process-managers/webhookDeliveryPrune";

export type { AutomationSubscriber } from "./subscribers/subscriber.types";
export {
  DEDUP_TTL_MS,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  MATCH_DELAY_MS,
  createEvaluationTriggerMatchSubscriber,
} from "./subscribers/evaluationTriggerMatch.subscriber";
export type {
  EvaluationOutcomeEvent,
  EvaluationTriggerMatchPorts,
  RecordMatchPort,
} from "./subscribers/evaluationTriggerMatch.subscriber";
export {
  GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
  createGraphTriggerActivitySubscriber,
  graphTriggerActivityDedupId,
} from "./subscribers/graphTriggerActivity.subscriber";
export type {
  GraphTriggerActivityPorts,
  TraceActivityEvent,
} from "./subscribers/graphTriggerActivity.subscriber";
