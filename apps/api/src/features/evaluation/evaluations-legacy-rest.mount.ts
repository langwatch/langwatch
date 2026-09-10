/**
 * Shares `ExperimentFindOrCreateService` with `POST /api/experiment/init` so
 * an SDK's `experiment_slug` can't resolve to different experiments.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  createEvaluationsLegacyRestApp,
  type EvaluationBatchExperimentPort,
  type EvaluationRunRestPorts,
  type EvaluationsLegacyCredentialPort,
} from "@langwatch/evaluation-server";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type {
  ExperimentFindOrCreateService,
  ExperimentService,
} from "@langwatch/experiment-server";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import type { ApiEvaluatorExecution } from "../../app/api-evaluator-execution.composition.ts";
import type { ApiHandlerManagedCredentialPort } from "../../app-rest/api-rest.runtime.ts";
import { listCustomEvaluators } from "../../platform/infrastructure/postgres.custom-evaluators.adapter.ts";

/** Everything `POST /api/evaluations/batch/log_results` binds to. */
export type ApiEvaluationBatchRestCollaborators = Readonly<{
  /** The ONE find-or-create rule this process resolves an SDK's slug through. */
  findOrCreate: ExperimentFindOrCreateService;
  /** The run history writer — the same one the workbench's own cells use. */
  experiments: () => EvaluationBatchExperimentPort;
  /** The verdict command; the same one the collector's evaluations travel on. */
  reportEvaluation: (input: Record<string, unknown>) => Promise<unknown>;
}>;

/** Everything the four evaluate doors bind to. */
export type ApiEvaluationRunRestCollaborators = Readonly<{
  /** The ONE guarded connection the monitor, dataset and cost rows are read on. */
  prisma: PrismaClient;
  /** The process's ONE evaluator runtime. */
  execution: ApiEvaluatorExecution;
  /** The saved-evaluator directory the `evaluators/{slug|id}` form resolves on. */
  evaluators: EvaluatorApi;
  /** The experiment a dataset evaluation's rows are grouped under. */
  experiments: ExperimentService;
  /** The cascade a project's default evaluator model is resolved through. */
  modelProviders: ModelProviderApi;
  /** The verdict command; the same one the batch log and the collector send. */
  reportEvaluation: (input: Record<string, unknown>) => Promise<unknown>;
  /** The ONE evaluator-id slug rule on this process. */
  deriveEvaluatorId: (name: string) => string;
}>;

/** The whole legacy family, on the halves this process can answer. */
export function mountEvaluationsLegacyRest(options: {
  security: AppRestSecurity;
  credential: ApiHandlerManagedCredentialPort;
  batch?: ApiEvaluationBatchRestCollaborators | undefined;
  evaluationRun?: ApiEvaluationRunRestCollaborators | undefined;
}): MountableRestApp {
  // Every credentialed route on this family asks for `evaluations:manage` —
  // the over-coarse grain the family's own access declaration records rather
  // than quietly widens.
  const credential: EvaluationsLegacyCredentialPort = (input) =>
    options.credential({ request: input.request, permission: "evaluations:manage" });

  const batch = options.batch;
  const run = options.evaluationRun;

  return createEvaluationsLegacyRestApp({
    security: options.security,
    ports: {
      credential,
      ...(batch
        ? {
            batch: {
              findOrCreateExperiment: (input) =>
                batch.findOrCreate.resolve({
                  projectId: input.projectId,
                  experimentId: input.experimentId,
                  experimentSlug: input.experimentSlug,
                  experimentType: input.experimentType,
                  experimentName: input.experimentName,
                  workflowId: input.workflowId,
                }),
              experiments: batch.experiments,
              reportEvaluation: batch.reportEvaluation,
            },
          }
        : {}),
      ...(run ? { evaluationRun: evaluationRunPorts(run) } : {}),
    },
  });
}

/** The evaluate doors' ports, over this process's own graph. */
function evaluationRunPorts(run: ApiEvaluationRunRestCollaborators): EvaluationRunRestPorts {
  return {
    runEvaluation: (input) => run.execution.runEvaluation(input),
    // The evaluator directory, with one narrowing: the service answers a saved
    // evaluator whose settings row is absent with `undefined`, and this door
    // reads a record. `{}` is what the handler's own merge falls back to on
    // that branch anyway — there is no monitor behind an `evaluators/{slug}`
    // call for `undefined` to defer to — so the two spellings mean one thing.
    evaluators: () => ({
      resolveForExecution: async (input) => {
        const resolved = await run.evaluators.resolveForExecution(input);
        return { ...resolved, settings: resolved.settings ?? {} };
      },
    }),
    tryGetMonitorBySlug: async (input) => {
      const monitor = await run.prisma.monitor.findUnique({
        where: { projectId_slug: { projectId: input.projectId, slug: input.slug } },
      });
      if (!monitor) return null;

      return {
        id: monitor.id,
        name: monitor.name,
        checkType: monitor.checkType,
        parameters: monitor.parameters,
        enabled: monitor.enabled,
      };
    },
    tryGetDatasetBySlug: (input) =>
      run.prisma.dataset.findFirst({
        where: { slug: input.slug, projectId: input.projectId },
        select: { id: true },
      }),
    tryGetExperimentBySlug: (input) =>
      run.experiments.findBySlug({ projectId: input.projectId, slug: input.slug }),
    listCustomEvaluators: (input) =>
      listCustomEvaluators({ prisma: run.prisma, projectId: input.projectId }),
    // Null rather than a thrown "not configured": the caller's only answer to
    // an unconfigured cascade is the evaluator's own default, so the exception
    // the cascade raises has no consumer on this path.
    resolveModelForFeature: async (input) => {
      try {
        const resolved = await run.modelProviders.resolveModelForFeature({
          projectId: input.projectId,
          featureKey: input.featureKey,
        });
        return resolved.model;
      } catch {
        return null;
      }
    },
    recordCost: (input) =>
      run.prisma.cost.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          costType: input.costType,
          costName: input.costName,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          amount: input.amount,
          currency: input.currency,
          ...(input.extraInfo ? { extraInfo: input.extraInfo as Prisma.InputJsonValue } : {}),
        },
        select: { id: true },
      }),
    recordBatchEvaluationRow: (input) =>
      run.prisma.batchEvaluation.create({
        data: input as Parameters<PrismaClient["batchEvaluation"]["create"]>[0]["data"],
      }),
    reportEvaluation: run.reportEvaluation,
    deriveEvaluatorId: run.deriveEvaluatorId,
  };
}
