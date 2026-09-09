import { defineModule } from "@langwatch/runtime-composition";
import { AgentApp } from "#app/agent.app";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { agentConnectRest } from "#transport/agent-connect.rest";
import { agentLegacyRest } from "#transport/agent-legacy.rest";
import { agentRest } from "#transport/agent.rest";
import { agentTrpcTransport } from "#transport/agent.trpc";
import { httpProxyTrpcTransport } from "#transport/http-proxy.trpc";

export const agentServer = defineModule("agent")
  .withRepositories(agentRepositories)
  .withApp(AgentApp)
  .withTransports(
    agentRest,
    agentConnectRest,
    agentLegacyRest,
    agentTrpcTransport,
    httpProxyTrpcTransport,
  )
  .build();
