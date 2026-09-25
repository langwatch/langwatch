import {
  bindRestMiddleware,
  browserCallerOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { WorkflowApp } from "#app/workflow.app";
import { workflowRepositories } from "#repositories/workflow-repositories.registry";
import {
  STUDIO_INVOKE_STAGING_THRESHOLD_BYTES,
  STUDIO_STAGING_TTL_SECONDS_DEFAULT,
  clampCodeBlockTimeoutSeconds,
  type StudioLambdaConfig,
  type StudioLambdaFleetFields,
} from "#rules/nlp-lambda-config.rules";
import { WorkflowPermissionService } from "#services/workflow-permission.service";
import { cronRest } from "#transport/cron.rest";
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
    cronRest,
  )
  .withTransportFacts(({ dependencies }) => [
    bindRestMiddleware(workflowStudioSession, (context) => {
      const caller = browserCallerOfRequest(context.req.raw);

      return caller?.userId ? { user: { id: caller.userId } } : null;
    }),
    // A legacy project key predates RBAC and carries full project access by
    // its class alone, so it always clears the ceiling. An api key with no
    // owning user checks nothing it can act on and is refused - fail closed
    // rather than guessing at a person's standing.
    bindRestMiddleware(workflowEvaluationRunCeiling, async (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      if (credential.type === "legacyProjectKey") return true;
      if (!credential.userId) return false;

      return WorkflowPermissionService.create({ authz: dependencies.authz }).has({
        userId: credential.userId,
        projectId: credential.project.id,
        permission: "evaluations:view",
      });
    }),
  ]);

function positiveNumber(raw: unknown, fallback: number): number {
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Assembles the studio's Lambda deployment from its already-parsed fields.
 * Pure: every raw string this needs is read once, at the process's own config
 * boot seam, and handed in here already resolved.
 */
export function buildStudioLambdaConfig(input: {
  fields: StudioLambdaFleetFields;
  /** Where a running function reports its traces back to; blank if unnamed. */
  langwatchEndpoint: string;
  codeBlockTimeoutRawValue: string | undefined;
  stagingThresholdBytesRawValue: unknown;
  stagingTtlSecondsRawValue: unknown;
}): StudioLambdaConfig {
  const { fields } = input;

  return {
    region: fields.region,
    accessKeyId: fields.accessKeyId,
    secretAccessKey: fields.secretAccessKey,
    roleArn: fields.roleArn,
    imageUri: fields.imageUri,
    cacheBucket: fields.cacheBucket,
    subnetIds: fields.subnetIds,
    securityGroupIds: fields.securityGroupIds,
    langwatchEndpoint: input.langwatchEndpoint,
    codeBlockTimeoutSeconds: clampCodeBlockTimeoutSeconds(input.codeBlockTimeoutRawValue),
    stagingThresholdBytes: positiveNumber(
      input.stagingThresholdBytesRawValue,
      STUDIO_INVOKE_STAGING_THRESHOLD_BYTES,
    ),
    stagingTtlSeconds: positiveNumber(
      input.stagingTtlSecondsRawValue,
      STUDIO_STAGING_TTL_SECONDS_DEFAULT,
    ),
  };
}
