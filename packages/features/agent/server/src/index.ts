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
export {
  AgentService,
  declaredAgentParameters,
  toAgentListRow,
  type AgentListRow,
} from "./services/agent.service";
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
} from "./transport/api-trpc/agent-test-tracing";

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
 * The connected-agent runtime of this process: the state store, the presence
 * registry and the call dispatcher, composed once and built on first use
 * (ADR-128).
 *
 * `installConnectedAgentRedis` is the composition root's, and is what makes
 * the runtime shared between replicas; without it the process runs on a
 * memory store and is correct only alone.
 */
export {
  closeConnectedAgentRuntime,
  type ConnectedAgentRuntime,
  createConnectedAgentRuntime,
  getConnectedAgentRuntime,
  installConnectedAgentRedis,
} from "./services/connected-agent-runtime.service";
export {
  type AgentStateStore,
  createMemoryStateStore,
  createRedisStateStore,
  type Unsubscribe,
} from "./adapters/connected-agent-state.adapter";
export {
  CallDispatcher,
  type CallDispatcherOptions,
  type DispatchParams,
} from "./adapters/connected-agent-dispatch.adapter";
export {
  InstanceRegistry,
  type InstanceMeta,
  type LiveInstance,
} from "./adapters/connected-agent-registry.adapter";
export {
  buildCallEnvelope,
  jsonByteLength,
  resultCapViolation,
  type StoredCall,
  type StoredResult,
  type StoredResultError,
} from "./adapters/connected-agent-envelope.adapter";
export {
  normalizeParameterSchema,
  type NormalizedParameters,
} from "./services/connected-agent-parameter-spec.service";
export {
  agentPresenceView,
  NO_PRESENCE,
  readAgentPresence,
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
  AgentSessionCore,
  type ConnectCredentials,
  type SessionCoreOptions,
  type SessionInfo,
} from "./services/connected-agent-session.service";
export {
  INSTANCE_TOKEN_HEADER,
  LongPollTransport,
  type LongPollTransportOptions,
  type RegisterAnswer,
  refusalStatus,
} from "./services/connected-agent-long-poll.service";
export { ConnectUpgradeRouterPort, type UpgradeHandler } from "./ports/connect-upgrade-router.port";
export {
  CONNECT_PATH,
  ConnectGateway,
  type ConnectGatewayOptions,
} from "./transport/api-ws/connected-agent-connect.api";
