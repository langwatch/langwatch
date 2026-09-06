export {
  PostgresAgentAdapter,
  type PostgresAgentAdapterOptions,
} from "./adapters/postgres.agent.adapter.ts";
export {
  PrismaAgentAdapter,
  type PrismaAgentAdapterOptions,
} from "./adapters/prisma.agent.adapter.ts";
export { UnavailableLinkedWorkflowCopyAdapter } from "./adapters/unavailable.linked-workflow-copy.adapter.ts";
export { AgentApp, type AgentAppDependencies } from "./app/agent.app.ts";
export { AgentService } from "./services/agent.service.ts";
export { type AgentListRow } from "./rules/agent-view.rules.ts";
export { AgentTrpcApi, type AgentTrpcContext } from "./transport/api-trpc/agent.api.ts";
export type { AgentsAuditLogPort, AgentsDatabase, AgentsWorkflowPort } from "./ports/agent.port.ts";
export { LinkedWorkflowCopyPort } from "./ports/linked-workflow-copy.port.ts";
export { AgentTestPort, type AgentTestActor } from "./ports/agent-test.port.ts";
export {
  HttpProxyTrpcApi,
  type HttpProxyTrpcContext,
  type HttpProxyTrpcPorts,
  type HttpProxyTrpcRequest,
} from "./transport/api-trpc/http-proxy.api.ts";
export {
  buildAgentTestTrace,
  buildTraceparentHeader,
  buildTraceTestContext,
  generateTraceIds,
  sanitizeHeadersForTrace,
  type AgentTestTrace,
  type TraceTestContext,
} from "./rules/agent-test-tracing.rules.ts";

/**
 * The deprecated `/api/agents` REST family this feature owns. The process
 * supplies the bound REST security service, a resolver for the legacy API and
 * the platform-url builder; the routes are the feature's.
 */
export {
  type AgentPlatformUrlBuilder,
  createAgentLegacyRestApp,
} from "./transport/api-rest/agent-legacy.api.ts";

/**
 * The `/api/v1/agents` REST family: list, create, read, update, archive,
 * test, call and the HTTP long-poll `/connect/*` routes (ADR-128).
 */
export { type AgentsV1Deps, createAgentV1RestApp } from "./transport/api-rest/agent-v1.api.ts";
export {
  registerCallEndpoint,
  relayCallBodySchema,
  relayCallResponseSchema,
  type AgentCallDeps,
  type AssertConnectedAgentsRunnablePort,
} from "./transport/api-rest/agent-call.api.ts";
export {
  registerConnectEndpoints,
  postedFramesSchema,
  registerAnswerSchema,
  pollAnswerSchema,
  framesAnswerSchema,
  type ConnectEndpointDeps,
} from "./transport/api-rest/agent-connect.api.ts";

/**
 * The connected-agent runtime of this process: the state store, the presence registry and
 * the call dispatcher, composed once and built on first use
 * (ADR-128).
 */
export { ConnectedAgentRuntimeAdapter } from "./adapters/connected-agent-runtime.adapter.ts";
export {
  ConnectedAgentDispatchPort,
  ConnectedAgentRegistryPort,
  type ConnectedAgentRuntime,
  type DispatchParams,
  type InstanceMeta,
  type LiveInstance,
} from "./ports/connected-agent-runtime.port.ts";
export { ConnectedAgentStateAdapter } from "./adapters/connected-agent-state.adapter.ts";
export {
  CallDispatcherAdapter,
  type CallDispatcherOptions,
} from "./adapters/connected-agent-dispatch.adapter.ts";
export { ConnectedAgentRegistryAdapter } from "./adapters/connected-agent-registry.adapter.ts";
export {
  ConnectedAgentParameterSpecService,
  type NormalizedParameters,
} from "./services/connected-agent-parameter-spec.service.ts";
export {
  ConnectedAgentPresenceService,
  NO_PRESENCE,
  type AgentInstanceView,
  type AgentOwnerView,
  type AgentPresence,
  type AgentPresenceStatus,
} from "./services/connected-agent-presence.service.ts";
export {
  ConnectCredentialPort,
  type ResolvedConnectCredential,
} from "./ports/connect-credential.port.ts";
export {
  AgentSessionService,
  type ConnectCredentials,
  type SessionCoreOptions,
  type SessionInfo,
} from "./services/connected-agent-session.service.ts";
export {
  LongPollTransportService,
  type LongPollTransportOptions,
  type RegisterAnswer,
} from "./services/connected-agent-long-poll.service.ts";
export {
  CONNECT_PATH,
  ConnectGateway,
  type ConnectGatewayOptions,
} from "./transport/api-ws/connected-agent-connect.api.ts";

// The pre-fix audit-log repair, main's `scripts/backfill-agent-audit-log-ids.ts`.
export {
  AgentAuditLogIdsBackfillTask,
  backfillAgentAuditLogIds,
  type AgentAuditLogBackfillOutcome,
} from "./tasks/agent-audit-log-ids-backfill.task.ts";
export {
  AgentAuditLogBackfillRepository,
  type AgentAuditLogBackfillDatabase,
} from "./repositories/prisma/prisma.agent-audit-log-backfill.repository.ts";
