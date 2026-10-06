import {
  bindRestHeader,
  bindRestMiddleware,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { AgentModule } from "#app/agent.app";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { connectCallerOf } from "#rules/agent-connect-caller.rules";
import { AgentHttpSecretsService } from "#services/agent-http-secrets.service";
import { AgentService } from "#services/agent.service";
import { AgentHttpCredentialsBackfillTask } from "#tasks/agent-http-credentials-backfill.task";
import { agentConnectCredentials, createAgentConnectRest } from "#transport/agent-connect.rest";
import { createAgentWebSocketProtocol } from "#transport/agent-connect.ws";
import { agentLegacyRest } from "#transport/agent-legacy.rest";
import { agentCallerKey, agentTraceparent, createAgentRest } from "#transport/agent.rest";
import { agentTrpcTransport } from "#transport/agent.trpc";
import { httpProxyTrpcTransport } from "#transport/http-proxy.trpc";

export const agentProcessModule = defineProcessModule("agent")
  .withRepositories(agentRepositories)
  .withApi(AgentModule)
  .withTransports(
    createAgentRest(),
    createAgentConnectRest(),
    createAgentWebSocketProtocol(),
    agentLegacyRest,
    agentTrpcTransport,
    httpProxyTrpcTransport,
  )
  .withTasks(({ repositories, dependencies }) => {
    const agents = AgentService.create(repositories.agents);

    return [
      AgentHttpCredentialsBackfillTask.create({
        agents,
        httpSecrets: AgentHttpSecretsService.create({ secrets: dependencies.secrets, agents }),
      }),
    ];
  })
  // The caller key and the connect caller are what the project door resolved; the rest
  // are request headers.
  .withTransportFacts(() => [
    bindRestHeader(agentTraceparent, "traceparent"),
    bindRestMiddleware(agentCallerKey, (context) => {
      const principal = principalOfCredential(projectCredentialOfRequest(context.req.raw));
      return principal?.type === "apiKey" ? principal.id : null;
    }),
    bindRestMiddleware(agentConnectCredentials, (context) => ({
      caller: connectCallerOf(projectCredentialOfRequest(context.req.raw)),
      instanceToken: context.req.header("x-agent-instance-token"),
    })),
  ]);
