export type { CodingAgentRepositories } from "./repositories/coding-agent.repositories.ts";
export type {
  CodingAgentBillingPolicy,
  CodingAgentClock,
  CodingAgentCostEstimator,
  CodingAgentProjectActivity,
  CodingAgentPullRequestMapping,
} from "./app/coding-agent.members.ts";
export type {
  CodingAgentBackfillProjects,
  CodingAgentSessionReads,
} from "./services/coding-agent-pull-request-mapping-backfill.service.ts";
export { SystemCodingAgentClockAdapter } from "./services/coding-agent-clock.service.ts";
export { ModelCatalogCostEstimatorAdapter } from "./services/model-catalog-cost-estimator.service.ts";
export { OtelCodingAgentCostMetricsAdapter } from "./services/coding-agent-cost-metrics.service.ts";
export type {
  CodingAgentCostMetrics,
  CodingAgentTraceProcessor,
} from "./app/coding-agent.members.ts";
export { createCodingAgentLogFactsDispatchSubscriber } from "./eventing/coding-agent-log-facts-dispatch.subscriber.ts";
export { createCodingAgentMetricFactsDispatchSubscriber } from "./eventing/coding-agent-metric-facts-dispatch.subscriber.ts";
export { createPullRequestMappingSubscriber } from "./eventing/pull-request-mapping.subscriber.ts";
export { NoopCodingAgentReadMetrics } from "./services/coding-agent-read-metrics-noop.service.ts";
export {
  type CodingAgentReadMetrics,
  type CodingAgentSessionListReadOutcome,
} from "./app/coding-agent.members.ts";
/**
 * The feature's application: the one typed thing its transports are given.
 * Both doors reach the same object, so a rule written on it is the rule both
 * doors get.
 */
export type {
  CallerProjectDisplay,
  CallerProjectScope,
  CodingAgentCallerScopeDependencies,
} from "./services/coding-agent-caller-scope.service.ts";
export {
  type CodingAgentCallerScopeDirectory,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  type CodingAgentScopePermissions,
  type CodingAgentScopeProject,
} from "./app/coding-agent.members.ts";
export type {
  CodingAgentCaller,
  CodingAgentCallerScope,
  CodingAgentPullRequestRef,
  CodingAgentScopeMembers,
} from "./app/coding-agent.app.ts";
export { codingAgentServer } from "./coding-agent.server.ts";
export {
  codingAgentRest,
  codingAgentRestCaller,
  codingAgentRollupRest,
} from "./transport/coding-agent.rest.ts";
export { codingAgentV1Rest, codingAgentV1RestCaller } from "./transport/coding-agent-v1.rest.ts";
export { codingAgentTrpcTransport } from "./transport/coding-agent.trpc.ts";
export {
  CODING_AGENT_SESSION_LIST_READ_METRIC_NAME,
  OtelCodingAgentReadMetricsAdapter,
} from "./services/coding-agent-read-metrics-otel.service.ts";
export type {
  CodingAgentAuditSink,
  CodingAgentViewerVisibility,
  CodingAgentViewerVisibilityReader,
} from "./app/coding-agent.app.ts";
