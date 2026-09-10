export { CodingAgentProjectionPersistenceService } from "./services/coding-agent-projection-persistence.service.ts";
export { codingAgentRepositories } from "./repositories/coding-agent-repositories.registry.ts";
export { ClickHouseCodingAgentRepositories } from "./repositories/clickhouse/clickhouse.coding-agent.repositories.ts";
export { MemoryCodingAgentRepositories } from "./repositories/memory/memory.coding-agent.repositories.ts";
export type { CodingAgentRepositories } from "./repositories/coding-agent.repositories.ts";
export { CodingAgentBillingPolicyPort } from "./ports/coding-agent-billing.port.ts";
export { CodingAgentClickHousePort } from "./ports/coding-agent-clickhouse.port.ts";
export { CodingAgentClockPort } from "./ports/coding-agent-clock.port.ts";
export {
  CodingAgentPullRequestMappingBackfillService,
  type CodingAgentBackfillProjects,
  type CodingAgentSessionReads,
} from "./services/coding-agent-pull-request-mapping-backfill.service.ts";
export { CodingAgentCostEstimatorPort } from "./ports/coding-agent-cost-estimator.port.ts";
export { CodingAgentProjectActivityPort } from "./ports/coding-agent-project-activity.port.ts";
export { CodingAgentPullRequestMappingPort } from "./ports/coding-agent-pull-request-mapping.port.ts";
export { SystemCodingAgentClockAdapter } from "./adapters/coding-agent-clock.adapter.ts";
export { ModelCatalogCostEstimatorAdapter } from "./adapters/model-catalog.cost-estimator.adapter.ts";
export {
  RedisCodingAgentProcessingRepository as ClickHouseCodingAgentProcessingAdapter,
  type ClickHouseCodingAgentProcessingAdapterOptions,
} from "./repositories/redis/redis.coding-agent-processing.repository.ts";
export {
  EventingCodingAgentProcessingAdapter,
  type CodingAgentProcessingPipeline,
  type CodingAgentProcessingPipelineDeps,
} from "./repositories/redis/redis.coding-agent-session-pipeline.repository.ts";
export { OtelCodingAgentCostMetricsAdapter } from "./adapters/otel.coding-agent-cost-metrics.adapter.ts";
export { CodingAgentCostMetricsPort } from "./ports/coding-agent-cost-metrics.port.ts";
export { CodingAgentTraceProcessingPort } from "./ports/coding-agent-trace-processing.port.ts";
export { createCodingAgentLogFactsDispatchSubscriber } from "./subscribers/coding-agent-log-facts-dispatch.subscriber.ts";
export { createCodingAgentMetricFactsDispatchSubscriber } from "./subscribers/coding-agent-metric-facts-dispatch.subscriber.ts";
export { createCodingAgentSpanFactsDispatchSubscriber } from "./subscribers/coding-agent-span-facts-dispatch.subscriber.ts";
export { createPullRequestMappingSubscriber } from "./subscribers/pull-request-mapping.subscriber.ts";
export { NoopCodingAgentReadMetricsPort } from "./adapters/coding-agent-read-metrics.adapter.ts";
export {
  CodingAgentReadMetricsPort,
  type CodingAgentSessionListReadOutcome,
} from "./ports/coding-agent-read-metrics.port.ts";
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
  CodingAgentCallerScopeDirectoryPort,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  CodingAgentScopePermissionsPort,
  type CodingAgentScopeProject,
} from "./ports/coding-agent-caller-scope.port.ts";
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
} from "./adapters/coding-agent-read-metrics.adapter.ts";
export type {
  CodingAgentAuditPort,
  CodingAgentViewerVisibility,
  CodingAgentViewerVisibilityPort,
} from "./app/coding-agent.app.ts";
