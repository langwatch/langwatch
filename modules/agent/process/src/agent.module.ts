import {
  bindRestHeader,
  bindRestMiddleware,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { AgentModule } from "#app/agent.app";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { AgentHttpSecretsService } from "#services/agent-http-secrets.service";
import { AgentService } from "#services/agent.service";
import { AgentHttpCredentialsBackfillTask } from "#tasks/agent-http-credentials-backfill.task";
import { agentConnectHeaders, createAgentConnectRest } from "#transport/agent-connect.rest";
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
  // The caller key is what the project door resolved; the rest are request headers.
  // The connect family's three are not the family's door: the application verifies
  // them itself and answers a refusal as a frame, which the agent protocol's client parses.
  .withTransportFacts(() => [
    bindRestHeader(agentTraceparent, "traceparent"),
    bindRestMiddleware(agentCallerKey, (context) => {
      const principal = principalOfCredential(projectCredentialOfRequest(context.req.raw));
      return principal?.type === "apiKey" ? principal.id : null;
    }),
    bindRestMiddleware(agentConnectHeaders, (context) => ({
      authorization: context.req.header("authorization"),
      projectId: context.req.header("x-project-id"),
      instanceToken: context.req.header("x-agent-instance-token"),
    })),
  ]);
