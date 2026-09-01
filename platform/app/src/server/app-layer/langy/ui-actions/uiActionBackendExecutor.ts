import { createLogger } from "@langwatch/observability";
import { projectWorkbenchState } from "~/experiments-v3/actions/projection";
import { scopeFromRunPayload } from "~/experiments-v3/actions/runScope";
import { getStatePayloadSchema, runPayloadSchema } from "~/experiments-v3/actions/schemas";
import type { WorkbenchState } from "~/experiments-v3/actions/transforms/types";
import { isTransformError } from "~/experiments-v3/actions/transforms/types";
import type { EvaluationResults } from "~/experiments-v3/types";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { NlpLambdaRuntime } from "~/runtime/api/nlp-lambda";
import { StaleWorkbenchStateError, type ExperimentService } from "@langwatch/experiment-contract";
import { startPollingRun } from "~/server/experiments-v3/execution/experimentRunner";
import {
  planSavedRunCarryOver,
  planSavedRunSeeding,
  prepareSavedStateExecution,
} from "~/server/experiments-v3/execution/savedStateExecution";
import { resolveWorkbenchTargetNames } from "~/server/experiments-v3/workbenchTargetNames";
import { LangyUiExperimentRequiredError, LangyUiHandlerFailedError } from "./errors";
import type { PageActionDefinition } from "./pageManifests";

const logger = createLogger("langwatch:langy:ui-actions:backend");

/**
 * The away-fallback half of the UI-action channel: the same action kinds the
 * open page executes, applied to the SAVED workbench state through the
 * server-owned seam. Which experiment to touch comes from the dispatch
 * request (`--experiment <slug>` on the CLI): the browser path never needs it
 * because the open page IS the experiment, so the field is fallback-only and
 * its absence is a refusal, not a guess.
 */
export interface BackendActionContext {
  projectId: string;
  projectSlug: string;
  userId: string;
  evaluationDefaultConcurrency: number;
  experimentSlug?: string;
}

/**
 * What a backend action needs beyond the workbench itself. The browser path
 * gets these from the request's App; the away path is handed them by its
 * route, so nothing here reaches for a process global.
 *
 * `prompts` is the read path's, not the run path's: naming a workbench column
 * means resolving a prompt handle, and it has to be the process's own Prompt
 * service so the name a reader sees is the name the run resolved.
 */
export interface BackendRunServices {
  evaluators: EvaluatorService;
  modelProviders: ModelProviderService;
  nlpLambda: NlpLambdaRuntime;
  prompts: PromptService;
  workflows: WorkflowService;
}

export async function executeBackendAction({
  experiments,
  runServices,
  context,
  kind,
  definition,
  payload,
}: {
  experiments: ExperimentService;
  runServices: BackendRunServices;
  context: BackendActionContext;
  kind: string;
  definition: PageActionDefinition;
  payload: unknown;
}): Promise<unknown> {
  const slug = context.experimentSlug;
  if (!slug) throw new LangyUiExperimentRequiredError(kind);

  switch (definition.backend) {
    case "read":
      return await readSavedState({ experiments, runServices, context, slug, payload });
    case "transform":
      return await applyTransform({
        experiments,
        context,
        slug,
        kind,
        definition,
        payload,
      });
    case "run":
      return await startSavedStateRun({
        experiments,
        runServices,
        context,
        slug,
        kind,
        payload,
      });
  }
}

async function readSavedState({
  experiments,
  runServices,
  context,
  slug,
  payload,
}: {
  experiments: ExperimentService;
  runServices: BackendRunServices;
  context: BackendActionContext;
  slug: string;
  payload: unknown;
}): Promise<unknown> {
  const current = await experiments.getWorkbenchState({
    projectId: context.projectId,
    slug,
  });
  const parsed = getStatePayloadSchema.parse(payload);
  if (!current.state) {
    return { source: "saved", version: current.version, state: null };
  }
  const state = current.state as unknown as WorkbenchState;
  const persistedResults = parsed.includeResults === false ? undefined : current.state.results;
  // The columns named the way the run's own errors name them. Resolved here
  // because the projection is pure and a prompt handle lives in the database.
  const targetNames = await resolveWorkbenchTargetNames({
    projectId: context.projectId,
    targets: state.targets,
    prompts: runServices.prompts,
  });
  const projection = projectWorkbenchState({
    state,
    targetNames,
    // The saved snapshot has no transient status; "idle" says exactly that.
    ...(persistedResults
      ? {
          results: {
            status: "idle",
            ...persistedResults,
          } as unknown as EvaluationResults,
        }
      : {}),
  });
  return { source: "saved", version: current.version, ...projection };
}

async function applyTransform({
  experiments,
  context,
  slug,
  kind,
  definition,
  payload,
  isRetry = false,
}: {
  experiments: ExperimentService;
  context: BackendActionContext;
  slug: string;
  kind: string;
  definition: PageActionDefinition;
  payload: unknown;
  isRetry?: boolean;
}): Promise<unknown> {
  const transform = definition.transform;
  if (!transform) throw new LangyUiHandlerFailedError(kind);

  const current = await experiments.getWorkbenchState({
    projectId: context.projectId,
    slug,
  });
  if (!current.state) throw new LangyUiHandlerFailedError(kind, "empty_state");

  let applied: { state: WorkbenchState; result?: unknown };
  try {
    applied = transform({
      state: current.state as unknown as WorkbenchState,
      payload: payload as never,
    });
  } catch (error) {
    if (isTransformError(error)) {
      throw new LangyUiHandlerFailedError(kind, error.code);
    }
    throw error;
  }

  try {
    const saved = await experiments.saveWorkbenchState({
      projectId: context.projectId,
      id: current.experimentId,
      state: applied.state,
      expectedVersion: current.version,
      actor: { userId: context.userId, label: "langy" },
      commitMessage: `Applied ${kind}`,
    });
    return { ...(asRecord(applied.result) ?? {}), version: saved.version };
  } catch (error) {
    // One retry on a concurrent write: re-read, re-apply, re-save. The
    // transform is pure, so replaying it over the fresh state is exactly what
    // a second attempt by hand would do. A second stale answer propagates.
    if (error instanceof StaleWorkbenchStateError && !isRetry) {
      logger.info({ kind, slug }, "stale save, retrying transform once");
      return await applyTransform({
        experiments,
        context,
        slug,
        kind,
        definition,
        payload,
        isRetry: true,
      });
    }
    throw error;
  }
}

async function startSavedStateRun({
  experiments,
  runServices,
  context,
  slug,
  kind,
  payload,
}: {
  experiments: ExperimentService;
  runServices: BackendRunServices;
  context: BackendActionContext;
  slug: string;
  kind: string;
  payload: unknown;
}): Promise<unknown> {
  const parsed = runPayloadSchema.parse(payload);

  const prepared = await prepareSavedStateExecution({
    experiments,
    evaluators: runServices.evaluators,
    projectId: context.projectId,
    slug,
  });
  if ("error" in prepared) {
    throw new LangyUiHandlerFailedError(kind, prepared.error);
  }

  const scope = scopeFromRunPayload(parsed);
  const seedTargetOutputs = planSavedRunSeeding({ prepared, scope });
  // The board the run carries in, so a scoped run still holds every column.
  const carriedOverCells = planSavedRunCarryOver({ prepared, scope });
  const { runId, total } = await startPollingRun({
    projectId: context.projectId,
    projectSlug: context.projectSlug,
    experimentId: prepared.experiment.id,
    experimentSlug: slug,
    scope,
    state: prepared.state,
    datasetRows: prepared.datasetRows,
    datasetColumns: prepared.datasetColumns,
    loadedPrompts: prepared.loadedPrompts,
    loadedAgents: prepared.loadedAgents,
    loadedEvaluators: prepared.loadedEvaluators,
    loadedWorkflows: prepared.loadedWorkflows,
    modelProviders: runServices.modelProviders,
    nlpLambda: runServices.nlpLambda,
    workflows: runServices.workflows,
    defaultConcurrency: context.evaluationDefaultConcurrency,
    // The saved cells the run reuses rather than recomputes. A comparison
    // judging this column against another one reads the other one from here.
    ...(seedTargetOutputs ? { seedTargetOutputs } : {}),
    // Every cell the run does not cover, copied from the saved board, so
    // opening the run shows the board rather than one column.
    ...(carriedOverCells.length > 0 ? { carriedOverCells } : {}),
    // The run evaluates the saved dataset, so its cells belong in the saved
    // state: without this the page the assistant is working for still reads
    // "No output yet" after the run finishes.
    persistResults: {
      experiments,
      actor: { userId: context.userId, label: "langy" },
    },
  });

  return { runId, status: "running", total };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
