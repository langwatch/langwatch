import { bindRestHeader, bindRestMiddleware } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { AgentApp } from "#app/agent.app";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { agentConnectHeaders, createAgentConnectRest } from "#transport/agent-connect.rest";
import { agentLegacyRest } from "#transport/agent-legacy.rest";
import { agentTraceparent, createAgentRest } from "#transport/agent.rest";
import { agentTrpcTransport } from "#transport/agent.trpc";
import { httpProxyTrpcTransport } from "#transport/http-proxy.trpc";

export const agentServer = defineServerModule("agent")
  .withRepositories(agentRepositories)
  .withApp(AgentApp)
  .withTransports(
    createAgentRest(),
    createAgentConnectRest(),
    agentLegacyRest,
    agentTrpcTransport,
    httpProxyTrpcTransport,
  )
  // Both are the request's own headers. The connect family's three are not the
  // family's door: the application verifies them itself and answers a refusal
  // as a frame, which is what the agent protocol's client parses.
  .withTransportFacts(() => [
    bindRestHeader(agentTraceparent, "traceparent"),
    bindRestMiddleware(agentConnectHeaders, (context) => ({
      authorization: context.req.header("authorization"),
      projectId: context.req.header("x-project-id"),
      instanceToken: context.req.header("x-agent-instance-token"),
    })),
  ])
  .build();
