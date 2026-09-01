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
export { AgentService } from "./services/agent.service";
export { AgentTrpcApi, type AgentTrpcContext } from "./transport/api-trpc/agent.api";
export type { AgentsAuditLogPort, AgentsDatabase, AgentsWorkflowPort } from "./ports/agent.port";
export { LinkedWorkflowCopyPort } from "./ports/linked-workflow-copy.port";
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
