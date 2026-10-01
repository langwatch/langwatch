import {
  bindRestHeader,
  bindRestMiddleware,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/process";

import { AgentApp } from "#app/agent.app";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { agentConnectHeaders, createAgentConnectRest } from "#transport/agent-connect.rest";
import { createAgentWebSocketProtocol } from "#transport/agent-connect.ws";
import { agentLegacyRest } from "#transport/agent-legacy.rest";
import {
  agentCallerKey,
  agentCallerKeyOf,
  agentTraceparent,
  createAgentRest,
} from "#transport/agent.rest";
import { agentTrpcTransport } from "#transport/agent.trpc";
import { httpProxyTrpcTransport } from "#transport/http-proxy.trpc";

export const agentServer = defineServerModule("agent")
  .withRepositories(agentRepositories)
  .withApp(AgentApp)
  .withTransports(
    createAgentRest(),
    createAgentConnectRest(),
    createAgentWebSocketProtocol(),
    agentLegacyRest,
    agentTrpcTransport,
    httpProxyTrpcTransport,
  )
  // The caller key is what the project door resolved; the rest are request headers.
  // The connect family's three are not the family's door: the application verifies
  // them itself and answers a refusal as a frame, which the agent protocol's client parses.
  .withTransportFacts(() => [
    bindRestHeader(agentTraceparent, "traceparent"),
    bindRestMiddleware(agentCallerKey, (context) =>
      agentCallerKeyOf(projectCredentialOfRequest(context.req.raw)),
    ),
    bindRestMiddleware(agentConnectHeaders, (context) => ({
      authorization: context.req.header("authorization"),
      projectId: context.req.header("x-project-id"),
      instanceToken: context.req.header("x-agent-instance-token"),
    })),
  ]);
