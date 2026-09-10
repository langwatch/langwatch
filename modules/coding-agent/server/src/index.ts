export { CodingAgentProjectionPersistenceService } from "./services/coding-agent-projection-persistence.service.ts";
export { codingAgentRepositories } from "./repositories/coding-agent-repositories.registry.ts";
export { ClickHouseCodingAgentRepositories } from "./repositories/clickhouse/clickhouse.coding-agent.repositories.ts";
export { MemoryCodingAgentRepositories } from "./repositories/memory/memory.coding-agent.repositories.ts";
export type { CodingAgentRepositories } from "./repositories/coding-agent.repositories.ts";
export {
  CodingAgentBillingPolicy,
  CodingAgentClickHouse,
  CodingAgentClock,
  CodingAgentCostEstimator,
  CodingAgentProjectActivity,
  CodingAgentPullRequestMapping,
} from "./app/coding-agent.infrastructure.ts";
export {
  CodingAgentPullRequestMappingBackfillService,
  type CodingAgentBackfillProjects,
  type CodingAgentSessionReads,
} from "./services/coding-agent-pull-request-mapping-backfill.service.ts";
export { SystemCodingAgentClockAdapter } from "./services/coding-agent-clock.service.ts";
export { ModelCatalogCostEstimatorAdapter } from "./services/model-catalog-cost-estimator.service.ts";
export {
  RedisCodingAgentProcessingRepository,
  type RedisCodingAgentProcessingRepositoryOptions,
} from "./repositories/redis/redis.coding-agent-processing.repository.ts";
export {
  EventingCodingAgentProcessingAdapter,
  type CodingAgentProcessingPipeline,
  type CodingAgentProcessingPipelineDeps,
} from "./repositories/redis/redis.coding-agent-session-pipeline.repository.ts";
export { OtelCodingAgentCostMetricsAdapter } from "./services/coding-agent-cost-metrics.service.ts";
export {
  CodingAgentCostMetrics,
  CodingAgentTraceProcessing,
} from "./app/coding-agent.infrastructure.ts";
export { createCodingAgentLogFactsDispatchSubscriber } from "./subscribers/coding-agent-log-facts-dispatch.subscriber.ts";
export { createCodingAgentMetricFactsDispatchSubscriber } from "./subscribers/coding-agent-metric-facts-dispatch.subscriber.ts";
export { createCodingAgentSpanFactsDispatchSubscriber } from "./subscribers/coding-agent-span-facts-dispatch.subscriber.ts";
export { createPullRequestMappingSubscriber } from "./subscribers/pull-request-mapping.subscriber.ts";
export { NoopCodingAgentReadMetrics } from "./services/coding-agent-read-metrics-noop.service.ts";
export {
  CodingAgentReadMetrics,
  type CodingAgentSessionListReadOutcome,
} from "./app/coding-agent.infrastructure.ts";
/**
 * The feature's application: the one typed thing its transports are given.
 * Both doors reach the same object, so a rule written on it is the rule both
 * doors get.
 */
export {
  CodingAgentCallerScopeService,
  type CallerProjectDisplay,
  type CallerProjectScope,
  type CodingAgentCallerScopeDependencies,
} from "./services/coding-agent-caller-scope.service.ts";
export {
  CodingAgentCallerScopeDirectory,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  CodingAgentScopePermissions,
  type CodingAgentScopeProject,
} from "./app/coding-agent.infrastructure.ts";
export {
  CodingAgentApp,
  CodingAgentUnavailableError,
  type CodingAgentCaller,
  type CodingAgentCallerScope,
  type CodingAgentPullRequestRef,
  type CodingAgentScopePorts,
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
  CodingAgentAuditPort,
  CodingAgentViewerVisibility,
  CodingAgentViewerVisibilityPort,
} from "./app/coding-agent.app.ts";
