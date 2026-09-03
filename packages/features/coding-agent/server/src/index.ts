export {
  CodingAgentProjectionPersistenceAdapter,
  CodingAgentProjectionPersistenceAdapter as CodingAgentProjectionPersistence,
  CodingAgentRuntime,
  type CodingAgentProjectionPersistenceOptions,
  type CodingAgentRuntimeOptions,
} from "./adapters/coding-agent.adapter";
export { CodingAgentBillingPolicyPort } from "./ports/coding-agent-billing.port";
export { CodingAgentClickHousePort } from "./ports/coding-agent-clickhouse.port";
export { CodingAgentClockPort } from "./ports/coding-agent-clock.port";
export { CodingAgentCostEstimatorPort } from "./ports/coding-agent-cost-estimator.port";
export { CodingAgentProjectActivityPort } from "./ports/coding-agent-project-activity.port";
export { CodingAgentPullRequestMappingPort } from "./ports/coding-agent-pull-request-mapping.port";
export { SystemCodingAgentClock } from "./adapters/coding-agent-clock.adapter";
export { ModelCatalogCostEstimatorAdapter } from "./adapters/model-catalog.cost-estimator.adapter";
export {
  ClickHouseCodingAgentProcessingAdapter,
  type ClickHouseCodingAgentProcessingAdapterOptions,
} from "./adapters/clickhouse.coding-agent-processing.adapter";
export {
  EventingCodingAgentProcessingAdapter,
  type CodingAgentProcessingPipeline,
  type CodingAgentProcessingPipelineDeps,
} from "./adapters/eventing.coding-agent-processing.adapter";
export { OtelCodingAgentCostMetricsAdapter } from "./adapters/otel.coding-agent-cost-metrics.adapter";
export { CodingAgentCostMetricsPort } from "./ports/coding-agent-cost-metrics.port";
export { CodingAgentTraceProcessingPort } from "./ports/coding-agent-trace-processing.port";
export { createCodingAgentLogFactsDispatchSubscriber } from "./subscribers/coding-agent-log-facts-dispatch.subscriber";
export { createCodingAgentMetricFactsDispatchSubscriber } from "./subscribers/coding-agent-metric-facts-dispatch.subscriber";
export { createCodingAgentSpanFactsDispatchSubscriber } from "./subscribers/coding-agent-span-facts-dispatch.subscriber";
export { createPullRequestMappingSubscriber } from "./subscribers/pull-request-mapping.subscriber";
export {
  CodingAgentReadMetricsPort,
  NoopCodingAgentReadMetricsPort,
  type CodingAgentSessionListReadOutcome,
} from "./adapters/coding-agent-read-metrics.adapter";
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
} from "./services/coding-agent-caller-scope.service";
export {
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentScopePermissionsPort,
  type CodingAgentScopeProject,
} from "./ports/coding-agent-caller-scope.port";
export {
  CodingAgentApp,
  type CodingAgentAppDependencies,
  type CodingAgentCaller,
  type CodingAgentCallerScope,
  type CodingAgentGithubConnection,
  type CodingAgentPullRequestRef,
  type CodingAgentScopePorts,
} from "./app/coding-agent.app";
export {
  CodingAgentTrpcApi,
  type CodingAgentTrpcContext,
  type CodingAgentTrpcPorts,
  type CodingAgentTrpcRequest,
  type CodingAgentViewerVisibility,
} from "./transport/api-trpc/coding-agent.api";
export {
  createCodingAgentRestApp,
  type CodingAgentRestAuditPort,
} from "./transport/api-rest/coding-agent.api";
export {
  CODING_AGENT_SESSION_LIST_READ_METRIC_NAME,
  OtelCodingAgentReadMetricsAdapter,
} from "./adapters/coding-agent-read-metrics.adapter";
