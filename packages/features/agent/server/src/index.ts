export {
  PrismaAgentAdapter,
  type PrismaAgentAdapterOptions,
} from "./adapters/prisma.agent.adapter";
export { AgentService } from "./services/agent.service";
export { AgentTrpcApi, type AgentTrpcContext } from "./api/app-trpc/agent.api";
export type { AgentsAuditLogPort, AgentsDatabase, AgentsWorkflowPort } from "./ports/agent.port";
export {
  HttpProxyTrpcApi,
  type HttpProxyResult,
  type HttpProxyTrpcContext,
  type HttpProxyTrpcPorts,
  type HttpProxyTrpcRequest,
} from "./api/app-trpc/http-proxy.api";
export {
  buildAgentTestTrace,
  buildTraceparentHeader,
  buildTraceTestContext,
  generateTraceIds,
  sanitizeHeadersForTrace,
  type AgentTestTrace,
  type TraceTestContext,
} from "./api/app-trpc/agent-test-tracing";

/**
 * The deprecated `/api/agents` REST family this feature owns. The process
 * supplies the bound REST security service, a resolver for the legacy API and
 * the platform-url builder; the routes are the feature's.
 */
export {
  type AgentPlatformUrlBuilder,
  createAgentLegacyRestApp,
} from "./api/app-rest/agent-legacy.api";
