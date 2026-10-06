import {
  bindRestMiddleware,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { WorkflowModule } from "#app/workflow.app";
import { workflowLifecycleEventing } from "#eventing/workflow-lifecycle.pipeline";
import { workflowNlpLambdaCleanupEventing } from "#eventing/workflow-nlp-lambda-cleanup.pipeline";
import { workflowRepositories } from "#repositories/workflow-repositories.registry";
import { WorkflowHttpSecretsService } from "#services/workflow-http-secrets.service";
import { WorkflowHttpCredentialsBackfillTask } from "#tasks/workflow-http-credentials-backfill.task";
import { workflowExecuteSyncRest } from "#transport/workflow-execute-sync.rest";
import { workflowOptimizationTrpcTransport } from "#transport/workflow-optimization.trpc";
import { workflowRunCallerKey, workflowRunRest } from "#transport/workflow-run.rest";
import { workflowStudioRest } from "#transport/workflow-studio.rest";
import { createWorkflowRest } from "#transport/workflow.rest";
import { workflowTrpcTransport } from "#transport/workflow.trpc";

export const workflowProcessModule = defineProcessModule("workflow")
  .withRepositories(workflowRepositories)
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
  .withTasks(({ repositories, dependencies }) => [
    WorkflowHttpCredentialsBackfillTask.create({
      workflows: repositories.workflows,
      httpSecrets: WorkflowHttpSecretsService.create(dependencies.secrets),
    }),
  ])
  .withTransportFacts(() => [
    bindRestMiddleware(workflowRunCallerKey, (context) => {
      const principal = principalOfCredential(projectCredentialOfRequest(context.req.raw));
      return principal?.type === "apiKey" ? principal.id : null;
    }),
  ]);
