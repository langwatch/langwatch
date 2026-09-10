import { defineModule } from "@langwatch/runtime-composition";
import { AgentApp } from "#app/agent.app";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { createAgentConnectRest } from "#transport/agent-connect.rest";
import { agentLegacyRest } from "#transport/agent-legacy.rest";
import { createAgentRest } from "#transport/agent.rest";
import { agentTrpcTransport } from "#transport/agent.trpc";
import { httpProxyTrpcTransport } from "#transport/http-proxy.trpc";

export const agentServer = defineModule("agent")
  .withRepositories(agentRepositories)
  .withApp(AgentApp)
  .withTransports(
    createAgentRest(),
    createAgentConnectRest(),
    agentLegacyRest,
    agentTrpcTransport,
    httpProxyTrpcTransport,
  )
  .build();
