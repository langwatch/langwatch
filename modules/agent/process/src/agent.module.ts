import type { AgentApi, AgentServerConfig } from "@langwatch/agent-contract";
import { projectCredentialOfRequest, projectRequestContextOf } from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { AgentModule } from "#app/agent.app";
import { agentLifecycleEventing } from "#eventing/agent-lifecycle.pipeline";
import { agentWorkflowFieldsEventing } from "#eventing/agent-workflow-fields.pipeline";
import { agentRepositories } from "#repositories/agent-repositories.registry";
import { connectCallerOf } from "#rules/agent-connect-caller.rules";
import { AgentHttpCredentialsBackfillService } from "#services/agent-http-credentials-backfill.service";
import { AgentHttpSecretsService } from "#services/agent-http-secrets.service";
import { AgentService } from "#services/agent.service";
import { createAgentConnectRest } from "#transport/agent-connect.rest";
import { createAgentWebSocketProtocol } from "#transport/agent-connect.ws";
import { agentLegacyRest } from "#transport/agent-legacy.rest";
import { agentTraceparent, createAgentRest } from "#transport/agent.rest";
import { agentTrpcTransport } from "#transport/agent.trpc";

export const agentProcessModule: PublishedProcessModule<"agent", AgentApi, AgentServerConfig> =
  defineProcessModule("agent")
    .withRepositories(agentRepositories)
    .withApi(AgentModule)
    .withTransports(
      createAgentRest(),
      createAgentConnectRest(),
      createAgentWebSocketProtocol(),
      agentLegacyRest,
      agentTrpcTransport,
    )
    .withEventing(agentLifecycleEventing)
    .withEventing(agentWorkflowFieldsEventing)
    .withMigrations(({ dependencies, repositories }) => [
      defineMigrationStep({
        id: "agent:move-http-credentials-to-secrets",
        kind: "data",
        mode: "background",
        description: "Stores credentials typed into HTTP agents as project secrets.",
        needsOldWritersGone: true,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterProjectId;
          return AgentHttpCredentialsBackfillService.create({
            agents: repositories.agents,
            httpSecrets: AgentHttpSecretsService.create({
              secrets: dependencies.secrets,
              agents: AgentService.create(repositories.agents),
            }),
          }).moveLiterals({
            dryRun,
            signal,
            afterProjectId: typeof resumed === "string" ? resumed : null,
            onProjectDone: (report) => checkpoint.save({ report }),
          });
        },
      }),
    ])
    // The connect caller is what the project door resolved; the rest are request headers.
    .provideMiddlewareContext({
      projectRequestContext: projectRequestContextOf,
      [agentTraceparent.name]: (request) => request.headers.get("traceparent"),
      agentConnectCredentials: (request) => ({
        caller: connectCallerOf(projectCredentialOfRequest(request)),
        instanceToken: request.headers.get("x-agent-instance-token") ?? undefined,
      }),
    });
