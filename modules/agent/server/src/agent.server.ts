import { defineModule } from "@langwatch/runtime-composition";
import { AgentApp } from "#app/agent.app";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { agentTrpcTransport } from "#transport/agent.trpc";
import { httpProxyTrpcTransport } from "#transport/http-proxy.trpc";

export const agentServer = defineModule("agent")
  .withRepositories(agentRepositories)
  .withApp(AgentApp)
  .withTransports(agentTrpcTransport, httpProxyTrpcTransport)
  .build();
