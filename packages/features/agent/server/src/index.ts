export { AgentApp, type AgentInfrastructure, type AgentAppConfig } from "./app/agent.app.ts";
export { nextAgentId } from "./rules/agent-id.rules.ts";
export { agentServer } from "./agent.server.ts";
export { agentTrpcTransport } from "./transport/agent.trpc.ts";
export { httpProxyTrpcTransport } from "./transport/http-proxy.trpc.ts";

// The deprecated `/api/agents` family and the `/api/v1/agents` family (list,
// create, read, update, archive, test, call and the HTTP long-poll `/connect/*`
// routes, ADR-128) are not exported: all four transport files still name deleted
// legacy builders.

export { CONNECT_PATH, createAgentWebSocketProtocol } from "./transport/agent-connect.ws.ts";
