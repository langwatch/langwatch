import {
  bindRestMiddleware,
  browserCallerOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { WorkflowApp } from "#app/workflow.app";
import { workflowLifecycleEventing } from "#eventing/workflow-lifecycle.pipeline";
import { workflowNlpLambdaCleanupEventing } from "#eventing/workflow-nlp-lambda-cleanup.pipeline";
import { workflowRepositories } from "#repositories/workflow-repositories.registry";
import { WorkflowPermissionService } from "#services/workflow-permission.service";
import { workflowOptimizationTrpcTransport } from "#transport/workflow-optimization.trpc";
import { workflowRunRest } from "#transport/workflow-run.rest";
import { workflowStudioRest, workflowStudioSession } from "#transport/workflow-studio.rest";
import { createWorkflowRest, workflowEvaluationRunCeiling } from "#transport/workflow.rest";
import { workflowTrpcTransport } from "#transport/workflow.trpc";

export const workflowServer = defineServerModule("workflow")
  .withRepositories(workflowRepositories)
  .withApp(WorkflowApp)
  .withTransports(
    createWorkflowRest(),
    workflowTrpcTransport,
    workflowOptimizationTrpcTransport,
    workflowRunRest,
    workflowStudioRest,
  )
  .withEventing(workflowNlpLambdaCleanupEventing)
  .withEventing(workflowLifecycleEventing)
  .withTransportFacts(({ dependencies }) => [
    bindRestMiddleware(workflowStudioSession, (context) => {
      const caller = browserCallerOfRequest(context.req.raw);

      return caller?.userId ? { user: { id: caller.userId } } : null;
    }),
    // A legacy project key predates RBAC and carries full project access by
    // its class alone. An api key answers for its own bindings, owner or not.
    bindRestMiddleware(workflowEvaluationRunCeiling, async (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      if (credential.type === "legacyProjectKey") return true;

      return WorkflowPermissionService.create({ authz: dependencies.authz }).hasApiKeyPermission({
        apiKeyId: credential.apiKeyId,
        userId: credential.userId,
        organizationId: credential.organizationId,
        projectId: credential.project.id,
        teamId: credential.project.teamId,
        permission: "evaluations:view",
      });
    }),
  ]);
