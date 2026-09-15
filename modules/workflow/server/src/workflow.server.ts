import {
  bindRestHeader,
  bindRestMiddleware,
  browserCallerOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule, instantiateRepositories } from "@langwatch/runtime-composition";
import { WorkflowApp } from "#app/workflow.app";
import {
  workflowRepositories,
  type WorkflowRepositories,
} from "#repositories/workflow-repositories.registry";
import { cronRest } from "#transport/cron.rest";
import { createWorkflowRest, workflowEvaluationRunCeiling } from "#transport/workflow.rest";
import { workflowRunContentType, workflowRunRest } from "#transport/workflow-run.rest";
import { workflowStudioRest, workflowStudioSession } from "#transport/workflow-studio.rest";
import { workflowOptimizationTrpcTransport } from "#transport/workflow-optimization.trpc";
import { workflowTrpcTransport } from "#transport/workflow.trpc";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { WorkflowPrismaDatabase } from "#repositories/prisma/prisma.workflow.repositories";
import { StudioEventPreparerService } from "#services/studio-event-preparer.service";
import { ContractWorkflowDslMigrationService } from "#services/workflow-dsl-migration.service";
import { WorkflowNlpExecutionService } from "#services/workflow-nlp-execution.service";
import {
  WorkflowProjectEnvironmentService,
  type WorkflowEnvironmentDecryptor,
} from "#services/workflow-project-environment.service";
import { WorkflowService } from "#services/workflow.service";
import {
  STUDIO_INVOKE_STAGING_THRESHOLD_BYTES,
  STUDIO_STAGING_TTL_SECONDS_DEFAULT,
  clampCodeBlockTimeoutSeconds,
  type StudioLambdaConfig,
  type StudioLambdaFleetFields,
} from "#rules/nlp-lambda-config.rules";
import type {
  WorkflowId,
  WorkflowLlmParameters,
  WorkflowNlpRuntime,
} from "#app/workflow.app";

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
  // The run family is handed the media type rather than a parsed body: the
  // body is the workflow's own entry fields, so nothing validates it. The
  // studio family answers its own 401 in the sentence the editor renders, so
  // the byte door's answer reaches it as a fact rather than as a refusal.
  .withTransportFacts(({ members }) => [
    bindRestHeader(workflowRunContentType, "content-type"),
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

      return members.permissions.has({
        userId: credential.userId,
        projectId: credential.project.id,
        permission: "evaluations:view",
      });
    }),
  ]);

/**
 * The rows this feature owns, bound once to a process's own Postgres. One of
 * the seams a composing process builds this feature through, so a composition
 * root never names a private service or registry.
 */
export function createWorkflowRepositories(input: {
  database: WorkflowPrismaDatabase;
}): WorkflowRepositories {
  return instantiateRepositories(workflowRepositories, {
    tier: "live",
    members: { prisma: input.database },
  });
}

export type WorkflowServiceCompositionInput = Readonly<{
  database: WorkflowPrismaDatabase;
  /** The dataset copies a Studio graph carries with it into another project. */
  datasets: DatasetApi;
  /** Resolves a Studio graph's models before any version of it is written. */
  modelProviders: ModelProviderApi;
  /** How a run's model parameters are resolved for the project it runs in. */
  llmParameters: WorkflowLlmParameters;
  /** Where a studio graph and a code evaluator both execute. */
  nlpRuntime: WorkflowNlpRuntime;
  /** Decrypts the project secrets a run executes with. */
  secretDecryptor: WorkflowEnvironmentDecryptor;
  /** Mints workflow and version ids. */
  ids: WorkflowId;
}>;

/**
 * The ONE workflow graph service a process serves, with its repositories, its
 * project environment and its studio event preparation wired underneath. Both
 * worker graphs that execute workflows build it through here.
 */
export function createWorkflowService(input: WorkflowServiceCompositionInput): WorkflowService {
  const repositories = createWorkflowRepositories({ database: input.database });
  const projectEnvironment = WorkflowProjectEnvironmentService.create({
    repository: repositories.projectEnvironment,
    encryption: input.secretDecryptor,
  });
  const studioEvents = StudioEventPreparerService.create({
    datasets: input.datasets,
    projectEnvironment,
    llmParameters: input.llmParameters,
  });

  return WorkflowService.create({
    repository: repositories.workflows,
    datasets: input.datasets,
    execution: WorkflowNlpExecutionService.create({
      ids: input.ids,
      modelProviders: input.modelProviders,
      nlpRuntime: input.nlpRuntime,
      studioEvents,
    }),
    studioEvents,
    dslMigration: ContractWorkflowDslMigrationService.create(),
    ids: input.ids,
  });
}

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
