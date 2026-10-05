import {
  bindRestMiddleware,
  browserCallerOfRequest,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { WorkflowModule } from "#app/workflow.app";
import { workflowLifecycleEventing } from "#eventing/workflow-lifecycle.pipeline";
import { workflowNlpLambdaCleanupEventing } from "#eventing/workflow-nlp-lambda-cleanup.pipeline";
import { workflowRepositories } from "#repositories/workflow-repositories.registry";
import { WorkflowHttpSecretsService } from "#services/workflow-http-secrets.service";
import { WorkflowPermissionService } from "#services/workflow-permission.service";
import { WorkflowHttpCredentialsBackfillTask } from "#tasks/workflow-http-credentials-backfill.task";
import { workflowExecuteSyncRest } from "#transport/workflow-execute-sync.rest";
import { workflowOptimizationTrpcTransport } from "#transport/workflow-optimization.trpc";
import { workflowRunCallerKey, workflowRunRest } from "#transport/workflow-run.rest";
import { workflowStudioRest, workflowStudioSession } from "#transport/workflow-studio.rest";
import { createWorkflowRest, workflowEvaluationRunCeiling } from "#transport/workflow.rest";
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
  .withTransportFacts(({ dependencies }) => [
    bindRestMiddleware(workflowRunCallerKey, (context) => {
      const principal = principalOfCredential(projectCredentialOfRequest(context.req.raw));
      return principal?.type === "apiKey" ? principal.id : null;
    }),
    bindRestMiddleware(workflowStudioSession, (context) => {
      const caller = browserCallerOfRequest(context.req.raw);

      return caller?.userId ? { user: { id: caller.userId } } : null;
    }),
    // A legacy API key predates RBAC and carries full project access by its class alone. Any
    // other credential is asked as its principal: a key its own row, a person's token the person.
    bindRestMiddleware(workflowEvaluationRunCeiling, async (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      const principal = principalOfCredential(credential);
      if (principal === null) return true;

      return WorkflowPermissionService.create({ authz: dependencies.authz }).holds({
        principal,
        project: credential.project,
        permission: "evaluations:view",
      });
    }),
  ]);
