import {
  bindRestMiddleware,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";
import type { WorkflowApi, WorkflowServerConfig } from "@langwatch/workflow-contract";

import { WorkflowModule } from "#app/workflow.app";
import { workflowChannels } from "#channels/workflow-channels.registry";
import { workflowAgentArchiveCascadeEventing } from "#eventing/workflow-agent-archive-cascade.pipeline";
import { workflowLifecycleEventing } from "#eventing/workflow-lifecycle.pipeline";
import { workflowNlpLambdaCleanupEventing } from "#eventing/workflow-nlp-lambda-cleanup.pipeline";
import { workflowRepositories } from "#repositories/workflow-repositories.registry";
import { WorkflowCurrentVersionBackfillService } from "#services/workflow-current-version-backfill.service";
import { WorkflowHttpSecretsService } from "#services/workflow-http-secrets.service";
import { WorkflowHttpCredentialsBackfillTask } from "#tasks/workflow-http-credentials-backfill.task";
import { workflowExecuteSyncRest } from "#transport/workflow-execute-sync.rest";
import { workflowOptimizationTrpcTransport } from "#transport/workflow-optimization.trpc";
import { workflowRunCallerKey, workflowRunRest } from "#transport/workflow-run.rest";
import { workflowStudioRest } from "#transport/workflow-studio.rest";
import { createWorkflowRest } from "#transport/workflow.rest";
import { workflowTrpcTransport } from "#transport/workflow.trpc";

export const workflowProcessModule: PublishedProcessModule<
  "workflow",
  WorkflowApi,
  WorkflowServerConfig
> = defineProcessModule("workflow")
  .withRepositories(workflowRepositories)
  .withChannels(workflowChannels)
  .withApi(WorkflowModule)
  .withTransports(
    createWorkflowRest(),
    workflowTrpcTransport,
    workflowOptimizationTrpcTransport,
    workflowRunRest,
    workflowStudioRest,
    workflowExecuteSyncRest,
  )
  .withEventing(workflowNlpLambdaCleanupEventing)
  .withEventing(workflowLifecycleEventing)
  .withEventing(workflowAgentArchiveCascadeEventing)
  .withTasks(({ repositories, dependencies }) => [
    WorkflowHttpCredentialsBackfillTask.create({
      workflows: repositories.workflows,
      httpSecrets: WorkflowHttpSecretsService.create(dependencies.secrets),
    }),
  ])
  // Background, after old writers are gone: agent's fields arrive from version_saved (round 20).
  .withMigrations(({ app, repositories }) => [
    defineMigrationStep({
      id: "workflow:record-current-version-fields",
      kind: "data",
      mode: "background",
      description: "Records each live workflow's current version with its fields for agent.",
      needsOldWritersGone: true,
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterTenantId;
        return WorkflowCurrentVersionBackfillService.create({
          workflows: repositories.workflows,
          versions: app,
        }).recordLiveWorkflows({
          dryRun,
          signal,
          afterTenantId: typeof resumed === "string" ? resumed : null,
          onTenantDone: ({ tenantId, report }) =>
            checkpoint.save({ report: { afterTenantId: tenantId, ...report } }),
        });
      },
    }),
  ])
  .withTransportFacts(() => [
    bindRestMiddleware(workflowRunCallerKey, (context) => {
      const principal = principalOfCredential(projectCredentialOfRequest(context.req.raw));
      return principal?.type === "apiKey" ? principal.id : null;
    }),
  ]);
