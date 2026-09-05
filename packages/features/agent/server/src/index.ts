export {
  PostgresAgentAdapter,
  type PostgresAgentAdapterOptions,
} from "./adapters/postgres.agent.adapter";
export {
  PrismaAgentAdapter,
  type PrismaAgentAdapterOptions,
} from "./adapters/prisma.agent.adapter";
export { UnavailableLinkedWorkflowCopyAdapter } from "./adapters/unavailable.linked-workflow-copy.adapter";
export { AgentApp, type AgentAppDependencies } from "./app/agent.app";
export { AgentService, type AgentListRow } from "./services/agent.service";
export { AgentTrpcApi, type AgentTrpcContext } from "./transport/api-trpc/agent.api";
export type { AgentsAuditLogPort, AgentsDatabase, AgentsWorkflowPort } from "./ports/agent.port";
export { LinkedWorkflowCopyPort } from "./ports/linked-workflow-copy.port";
export {
  AgentTestPort,
  type AgentTestActor,
  type AgentTestRunResult,
  type AgentTestTurnResult,
} from "./ports/agent-test.port";
export {
  HttpProxyTrpcApi,
  type HttpProxyResult,
  type HttpProxyTrpcContext,
  type HttpProxyTrpcPorts,
  type HttpProxyTrpcRequest,
} from "./transport/api-trpc/http-proxy.api";
export {
  buildAgentTestTrace,
  buildTraceparentHeader,
  buildTraceTestContext,
  generateTraceIds,
  sanitizeHeadersForTrace,
  type AgentTestTrace,
  type TraceTestContext,
} from "./rules/agent-test-tracing.rules";

/**
 * The deprecated `/api/agents` REST family this feature owns. The process
 * supplies the bound REST security service, a resolver for the legacy API and
 * the platform-url builder; the routes are the feature's.
 */
export {
  type AgentPlatformUrlBuilder,
  createAgentLegacyRestApp,
} from "./transport/api-rest/agent-legacy.api";

/**
 * The `/api/v1/agents` REST family: list, create, read, update, archive,
 * test, call and the HTTP long-poll `/connect/*` routes (ADR-128).
 */
export { type AgentsV1Deps, createAgentV1RestApp } from "./transport/api-rest/agent-v1.api";
export {
  registerCallEndpoint,
  relayCallBodySchema,
  relayCallResponseSchema,
  type AgentCallDeps,
  type AssertConnectedAgentsRunnablePort,
} from "./transport/api-rest/agent-call.api";
export {
  registerConnectEndpoints,
  postedFramesSchema,
  registerAnswerSchema,
  pollAnswerSchema,
  framesAnswerSchema,
  type ConnectEndpointDeps,
} from "./transport/api-rest/agent-connect.api";

/**
 * The connected-agent runtime of this process: the state store, the presence registry and
 * the call dispatcher, composed once and built on first use
 * (ADR-128).
 */
export { ConnectedAgentRuntimeAdapter } from "./adapters/connected-agent-runtime.adapter";
export {
  ConnectedAgentDispatchPort,
  ConnectedAgentRegistryPort,
  type ConnectedAgentRuntime,
  type DispatchParams,
  type InstanceMeta,
  type LiveInstance,
} from "./ports/connected-agent-runtime.port";
export { AgentStateStorePort, type Unsubscribe } from "./ports/agent-state-store.port";
export { ConnectedAgentStateAdapter } from "./adapters/connected-agent-state.adapter";
export {
  CallDispatcherAdapter,
  type CallDispatcherOptions,
} from "./adapters/connected-agent-dispatch.adapter";
export { ConnectedAgentRegistryAdapter } from "./adapters/connected-agent-registry.adapter";
export {
  buildCallEnvelope,
  jsonByteLength,
  resultCapViolation,
  type StoredCall,
  type StoredResult,
  type StoredResultError,
} from "./services/connected-agent-envelope.service";
export {
  ConnectedAgentParameterSpecService,
  type NormalizedParameters,
} from "./services/connected-agent-parameter-spec.service";
export {
  ConnectedAgentPresenceService,
  NO_PRESENCE,
  type AgentInstanceView,
  type AgentOwnerView,
  type AgentPresence,
  type AgentPresenceStatus,
} from "./services/connected-agent-presence.service";
export {
  ConnectCredentialPort,
  type ResolvedConnectCredential,
} from "./ports/connect-credential.port";
export {
  AgentSessionService,
  type ConnectCredentials,
  type SessionCoreOptions,
  type SessionInfo,
} from "./services/connected-agent-session.service";
export {
  INSTANCE_TOKEN_HEADER,
  LongPollTransportService,
  type LongPollTransportOptions,
  type RegisterAnswer,
} from "./services/connected-agent-long-poll.service";
export { ConnectUpgradeRouterPort, type UpgradeHandler } from "./ports/connect-upgrade-router.port";
export {
  CONNECT_PATH,
  ConnectGateway,
  type ConnectGatewayOptions,
} from "./transport/api-ws/connected-agent-connect.api";

// The pre-fix audit-log repair, main's `scripts/backfill-agent-audit-log-ids.ts`.
export {
  AgentAuditLogIdsBackfillTask,
  backfillAgentAuditLogIds,
  type AgentAuditLogBackfillDatabase,
  type AgentAuditLogBackfillOutcome,
} from "./tasks/agent-audit-log-ids-backfill.task";
