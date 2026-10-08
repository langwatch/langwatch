import {
  bindRestHeader,
  bindRestMiddleware,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { AgentModule } from "#app/agent.app";
import { agentLifecycleEventing } from "#eventing/agent-lifecycle.pipeline";
import { agentWorkflowFieldsEventing } from "#eventing/agent-workflow-fields.pipeline";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { connectCallerOf } from "#rules/agent-connect-caller.rules";
import { AgentHttpSecretsService } from "#services/agent-http-secrets.service";
import { AgentService } from "#services/agent.service";
import { AgentHttpCredentialsBackfillTask } from "#tasks/agent-http-credentials-backfill.task";
import { agentConnectCredentials, createAgentConnectRest } from "#transport/agent-connect.rest";
import { createAgentWebSocketProtocol } from "#transport/agent-connect.ws";
import { agentLegacyRest } from "#transport/agent-legacy.rest";
import { agentTraceparent, createAgentRest } from "#transport/agent.rest";
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
  .withEventing(agentLifecycleEventing)
  .withEventing(agentWorkflowFieldsEventing)
  .withTasks(({ repositories, dependencies }) => {
    const agents = AgentService.create(repositories.agents);

    return [
      AgentHttpCredentialsBackfillTask.create({
        agents,
        httpSecrets: AgentHttpSecretsService.create({ secrets: dependencies.secrets, agents }),
      }),
    ];
  })
  // The connect caller is what the project door resolved; the rest are request headers.
  .withTransportFacts(() => [
    bindRestHeader(agentTraceparent, "traceparent"),
    bindRestMiddleware(agentConnectCredentials, (context) => ({
      caller: connectCallerOf(projectCredentialOfRequest(context.req.raw)),
      instanceToken: context.req.header("x-agent-instance-token"),
    })),
  ]);
