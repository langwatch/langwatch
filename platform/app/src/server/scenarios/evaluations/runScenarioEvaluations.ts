/**
 * Runs the evaluators attached to a finished scenario run and records their
 * results on the run.
 *
 * The worker behind the scenario evaluations job. It loads the scenario, the
 * attachments of its suite and its plan, the saved evaluators they name and
 * the run's own state, resolves every mapping, runs each evaluator through
 * the shared evaluation runner, writes each evaluation that ran on the run's
 * last trace, and records one result per attachment through the record
 * evaluations command, which applies the gate.
 *
 * Every dependency is an interface the composition root fills in, so the
 * orchestration is testable with stubs.
 *
 * @see specs/scenarios/scenario-evaluators.feature
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { Scenario } from "~/generated/prisma/client";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";
import type { DataForEvaluation } from "~/server/evaluations/runEvaluation";
import { CODE_EVALUATOR_CHECK_PREFIX } from "~/server/evaluators/codeEvaluator";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import type { RecordEvaluationsCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import { evaluatorInputSpecsOf } from "~/server/suites/suite-evaluators";
import type { Span, Trace } from "~/server/tracer/types";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { EvaluatorAttachment } from "../evaluator-attachments";
import type { RunEvaluators } from "../scenario-run-evaluators";
import type { ScenarioEvaluationResult } from "../schemas/event-schemas";
import { parseScenarioFieldValues } from "../suite-fields";
import {
  attachmentsReadTrace,
  type ConversationMessage,
  type ResolvedValue,
  type RunInputs,
  resolveAttachmentInputs,
  type ScenarioInputs,
  storedInputsOf,
} from "./resolveScenarioMappings";
import type { ScenarioEvaluationsJobPayload } from "./types";

const logger = createLogger("langwatch:scenarios:evaluations");

/** What the run left in the store that the mappings read. */
export interface ScenarioRunState {
  messages: ConversationMessage[];
  traceIds: string[];
}

/** One evaluation as it is written on a trace. */
export interface TraceEvaluationReport {
  tenantId: string;
  evaluationId: string;
  evaluatorId: string;
  evaluatorType: string;
  evaluatorName?: string;
  traceId: string;
  status: SingleEvaluationResult["status"];
  score?: number;
  passed?: boolean;
  label?: string;
  details?: string;
  error?: string;
  inputs?: Record<string, unknown>;
  occurredAt: number;
}

export interface RunScenarioEvaluationsDeps {
  scenarios: {
    getById(params: {
      projectId: string;
      id: string;
    }): Promise<Pick<
      Scenario,
      "id" | "situation" | "criteria" | "fields" | "testSuiteId"
    > | null>;
  };
  suites: {
    getRunAttachments(params: {
      projectId: string;
      suiteId?: string | null;
      planId?: string | null;
    }): Promise<EvaluatorAttachment[]>;
    getAttachedEvaluators(params: {
      projectId: string;
      attachments: readonly Pick<EvaluatorAttachment, "evaluatorId">[];
    }): Promise<Map<string, EvaluatorWithFields>>;
  };
  runs: {
    getRunState(params: {
      tenantId: string;
      scenarioRunId: string;
    }): Promise<ScenarioRunState | null>;
  };
  spans: {
    getSpansByTraceId(params: {
      tenantId: string;
      traceId: string;
    }): Promise<Span[]>;
  };
  /** The shared evaluation runner (`runEvaluation`). */
  runEvaluation(params: {
    projectId: string;
    evaluatorType: string;
    data: DataForEvaluation;
    settings?: Record<string, unknown>;
    trace?: Trace;
    workflowId?: string | null;
  }): Promise<SingleEvaluationResult>;
  /** Writes one evaluation on a trace, so it shows in the trace drawer. */
  reportEvaluation(report: TraceEvaluationReport): Promise<void>;
  /** The record evaluations command of the simulation pipeline. */
  recordEvaluations(data: RecordEvaluationsCommandData): Promise<void>;
}

/**
 * Thrown when a mapping reads the trace and the spans have not arrived yet.
 * The job catches it and queues itself again with a delay.
 */
export class TraceDataPendingError extends Error {
  constructor(details: string) {
    super(details);
    this.name = "TraceDataPendingError";
  }
}

/**
 * The evaluator attachments one run reads, with the suite and the plan they
 * came from.
 *
 * Read when the run is queued, so the set the run is graded with is fixed
 * before it executes, and again when a run that never passed through the
 * queue command finishes.
 */
export async function loadRunAttachments({
  deps,
  projectId,
  scenarioId,
  planId,
}: {
  deps: Pick<RunScenarioEvaluationsDeps, "scenarios" | "suites">;
  projectId: string;
  scenarioId: string;
  planId: string | null;
}): Promise<RunEvaluators> {
  const scenario = await deps.scenarios.getById({ projectId, id: scenarioId });
  const suiteId = scenario?.testSuiteId ?? null;
  const attachments = await deps.suites.getRunAttachments({
    projectId,
    suiteId,
    planId,
  });
  return { suiteId, planId, attachments };
}

/**
 * The evaluator type the runner dispatches on: a workflow evaluator runs as
 * its workflow, a code evaluator as its own id, a built-in as the type its
 * config names.
 */
export function checkTypeOf(
  evaluator: Pick<EvaluatorWithFields, "id" | "type" | "workflowId" | "config">,
): string | null {
  if (evaluator.type === "workflow" && evaluator.workflowId) {
    return `custom/${evaluator.workflowId}`;
  }
  if (evaluator.type === "code") {
    return `${CODE_EVALUATOR_CHECK_PREFIX}${evaluator.id}`;
  }
  const config = evaluator.config as { evaluatorType?: string } | null;
  return config?.evaluatorType ?? null;
}

/** The settings a saved evaluator carries for its type. */
export function settingsOf(
  evaluator: Pick<EvaluatorWithFields, "config">,
): Record<string, unknown> {
  const config = evaluator.config as {
    settings?: Record<string, unknown>;
  } | null;
  return config?.settings ?? {};
}

/** The runner's input shape for the resolved values. */
export function dataForEvaluation({
  checkType,
  data,
}: {
  checkType: string;
  data: Record<string, ResolvedValue>;
}): DataForEvaluation {
  if (
    checkType.startsWith("custom/") ||
    checkType.startsWith(CODE_EVALUATOR_CHECK_PREFIX)
  ) {
    return { type: "custom", data };
  }
  return {
    type: "default",
    data: data as DataForEvaluation["data"],
  };
}

/**
 * The trace the runner is given: the run's last trace with its spans, so the
 * evaluation's own spans nest under it and content dropped at ingestion is
 * read off the spans. Absent when the run produced no trace.
 */
export function traceForEvaluation({
  projectId,
  traceId,
  spans,
}: {
  projectId: string;
  traceId: string | undefined;
  spans: Span[];
}): Trace | undefined {
  if (!traceId) return undefined;
  const traceSpans = spans.filter((span) => span.trace_id === traceId);
  const startedAt = Math.min(
    ...traceSpans.map((span) => span.timestamps.started_at),
    Date.now(),
  );
  return {
    trace_id: traceId,
    project_id: projectId,
    metadata: {},
    timestamps: {
      started_at: startedAt,
      inserted_at: startedAt,
      updated_at: startedAt,
    },
    spans: traceSpans,
  };
}

/**
 * The verdict fields of a processed result: a pass reads as passed or
 * failed, a result with no pass reads as scored.
 */
function processedFieldsOf(
  result: Extract<SingleEvaluationResult, { status: "processed" }>,
): Pick<
  ScenarioEvaluationResult,
  "status" | "passed" | "score" | "label" | "details" | "cost"
> {
  // The runner spells an absent value as null; the stored result leaves it out.
  const status =
    result.passed == null ? "scored" : result.passed ? "passed" : "failed";
  return {
    status,
    ...(result.passed != null && { passed: result.passed }),
    ...(result.score != null && { score: result.score }),
    ...(result.label != null && { label: result.label }),
    ...(result.details != null && { details: result.details }),
    ...(result.cost && { cost: result.cost }),
  };
}

/** One evaluator's result as the run records it. */
export function toScenarioEvaluationResult({
  attachment,
  name,
  result,
  inputs,
}: {
  attachment: Pick<EvaluatorAttachment, "evaluatorId" | "required">;
  name: string;
  result: SingleEvaluationResult;
  inputs: Record<string, string>;
}): ScenarioEvaluationResult {
  const base = {
    evaluatorId: attachment.evaluatorId,
    name,
    required: attachment.required,
    ...(Object.keys(inputs).length > 0 && { inputs }),
  };
  switch (result.status) {
    case "processed":
      return { ...base, ...processedFieldsOf(result) };
    case "skipped":
      return {
        ...base,
        status: "skipped",
        ...(result.details != null && { details: result.details }),
      };
    case "error":
      return { ...base, status: "error", details: result.details };
  }
}

/** The evaluation as the trace records it, for one runner result. */
function traceReportOf({
  tenantId,
  traceId,
  attachment,
  evaluatorType,
  evaluatorName,
  result,
  inputs,
  occurredAt,
}: {
  tenantId: string;
  traceId: string;
  attachment: Pick<EvaluatorAttachment, "evaluatorId">;
  evaluatorType: string;
  evaluatorName: string;
  result: SingleEvaluationResult;
  inputs: Record<string, ResolvedValue>;
  occurredAt: number;
}): TraceEvaluationReport {
  const processed = result.status === "processed" ? result : undefined;
  return {
    tenantId,
    evaluationId: generate(KSUID_RESOURCES.EVALUATION).toString(),
    evaluatorId: attachment.evaluatorId,
    evaluatorType,
    evaluatorName,
    traceId,
    status: result.status,
    ...(processed?.score !== undefined && { score: processed.score }),
    ...(processed?.passed !== undefined && { passed: processed.passed }),
    ...(processed?.label !== undefined && { label: processed.label }),
    ...(result.status !== "error" &&
      result.details !== undefined && { details: result.details }),
    ...(result.status === "error" && { error: result.details }),
    inputs,
    occurredAt,
  };
}

const errorResult = (details: string): SingleEvaluationResult => ({
  status: "error",
  error_type: "INTERNAL_ERROR",
  details,
  traceback: [],
});

async function loadSpans({
  deps,
  tenantId,
  traceIds,
}: {
  deps: Pick<RunScenarioEvaluationsDeps, "spans">;
  tenantId: string;
  traceIds: string[];
}): Promise<Span[]> {
  const perTrace = await Promise.all(
    traceIds.map((traceId) =>
      deps.spans.getSpansByTraceId({ tenantId, traceId }),
    ),
  );
  return perTrace.flat();
}

/** Everything one run offers to its evaluators, loaded once. */
interface RunContext {
  projectId: string;
  scenarioRunId: string;
  run: RunInputs;
  scenario: ScenarioInputs;
  /** The run's last trace, the one the evaluations are written on. */
  lastTraceId: string | undefined;
  trace: Trace | undefined;
  isFinalAttempt: boolean;
}

/** Runs one evaluator through the runner; a thrown error becomes an error result. */
async function runOne({
  deps,
  context,
  evaluator,
  checkType,
  data,
}: {
  deps: Pick<RunScenarioEvaluationsDeps, "runEvaluation">;
  context: RunContext;
  evaluator: EvaluatorWithFields;
  checkType: string;
  data: Record<string, ResolvedValue>;
}): Promise<SingleEvaluationResult> {
  try {
    return await deps.runEvaluation({
      projectId: context.projectId,
      evaluatorType: checkType,
      data: dataForEvaluation({ checkType, data }),
      settings: settingsOf(evaluator),
      trace: context.trace,
      workflowId: evaluator.workflowId,
    });
  } catch (error) {
    logger.error(
      {
        projectId: context.projectId,
        scenarioRunId: context.scenarioRunId,
        evaluatorId: evaluator.id,
        error,
      },
      "Evaluator failed to run on the scenario run",
    );
    return errorResult(
      error instanceof Error ? error.message : "The evaluator failed to run",
    );
  }
}

/**
 * The result one attachment records: an error when its evaluator is gone,
 * a skip or a failure when its inputs cannot be read, else the evaluator's
 * own verdict, which is also written on the run's last trace.
 */
async function evaluateAttachment({
  deps,
  context,
  attachment,
  evaluator,
}: {
  deps: Pick<RunScenarioEvaluationsDeps, "runEvaluation" | "reportEvaluation">;
  context: RunContext;
  attachment: EvaluatorAttachment;
  evaluator: EvaluatorWithFields | undefined;
}): Promise<ScenarioEvaluationResult> {
  const name = evaluator?.name ?? attachment.evaluatorId;
  const record = (result: SingleEvaluationResult, inputs = {}) =>
    toScenarioEvaluationResult({ attachment, name, result, inputs });

  if (!evaluator) {
    return record(errorResult("The evaluator was not found in this project"));
  }
  const checkType = checkTypeOf(evaluator);
  if (!checkType) {
    return record(errorResult("The evaluator names no evaluator type"));
  }

  const resolved = resolveAttachmentInputs({
    attachment,
    inputs: evaluatorInputSpecsOf(evaluator),
    run: context.run,
    scenario: context.scenario,
    isFinalAttempt: context.isFinalAttempt,
  });
  if (resolved.kind === "pending" && !context.isFinalAttempt) {
    throw new TraceDataPendingError(resolved.details);
  }
  if (resolved.kind === "skipped") {
    return record({ status: "skipped", details: resolved.details });
  }
  if (resolved.kind !== "ready") {
    return record({
      status: "processed",
      passed: false,
      details: resolved.details,
    });
  }

  const occurredAt = Date.now();
  const result = await runOne({
    deps,
    context,
    evaluator,
    checkType,
    data: resolved.data,
  });
  if (context.lastTraceId) {
    try {
      await deps.reportEvaluation(
        traceReportOf({
          tenantId: context.projectId,
          traceId: context.lastTraceId,
          attachment,
          evaluatorType: checkType,
          evaluatorName: evaluator.name,
          result,
          inputs: resolved.data,
          occurredAt,
        }),
      );
    } catch (error) {
      logger.warn(
        {
          projectId: context.projectId,
          scenarioRunId: context.scenarioRunId,
          evaluatorId: evaluator.id,
          error,
        },
        "Could not write the evaluation on the trace; the result is still recorded",
      );
    }
  }
  return record(result, storedInputsOf(resolved.data));
}

/**
 * Runs the evaluators of one finished run and records the results.
 *
 * On any attempt but the last, a trace that has not arrived throws
 * `TraceDataPendingError` before anything is recorded, so the whole run is
 * graded in one go once the data is there. On the last attempt the missing
 * data is recorded as a failed result with its reason.
 */
export async function runScenarioEvaluations({
  deps,
  payload,
  isFinalAttempt,
}: {
  deps: RunScenarioEvaluationsDeps;
  payload: ScenarioEvaluationsJobPayload;
  isFinalAttempt: boolean;
}): Promise<ScenarioEvaluationResult[]> {
  const { tenantId: projectId, scenarioRunId, scenarioId, planId } = payload;

  const scenario = await deps.scenarios.getById({ projectId, id: scenarioId });
  if (!scenario) {
    logger.warn(
      { projectId, scenarioRunId, scenarioId },
      "Scenario not found, the run is not evaluated",
    );
    return [];
  }
  // The job carries the attachments the run was queued with, so a suite or a
  // plan edited while the run executed does not change what it is graded
  // against, and a retry grades exactly what the first attempt would have.
  // A payload written before they were carried reads them now instead.
  const attachments =
    payload.attachments ??
    (await deps.suites.getRunAttachments({
      projectId,
      suiteId: scenario.testSuiteId,
      planId,
    }));
  if (attachments.length === 0) return [];

  const [evaluatorsById, runState] = await Promise.all([
    deps.suites.getAttachedEvaluators({ projectId, attachments }),
    deps.runs.getRunState({ tenantId: projectId, scenarioRunId }),
  ]);

  const traceIds = [
    ...new Set([...payload.traceIds, ...(runState?.traceIds ?? [])]),
  ];
  const spans = attachmentsReadTrace(attachments)
    ? await loadSpans({ deps, tenantId: projectId, traceIds })
    : [];
  const lastTraceId = traceIds.at(-1);
  const context: RunContext = {
    projectId,
    scenarioRunId,
    run: {
      messages: runState?.messages ?? [],
      spans,
      hasTraces: traceIds.length > 0,
    },
    scenario: {
      situation: scenario.situation,
      criteria: scenario.criteria,
      fields: parseScenarioFieldValues(scenario.fields),
    },
    lastTraceId,
    trace: traceForEvaluation({ projectId, traceId: lastTraceId, spans }),
    isFinalAttempt,
  };

  const evaluations: ScenarioEvaluationResult[] = [];
  for (const attachment of attachments) {
    evaluations.push(
      await evaluateAttachment({
        deps,
        context,
        attachment,
        evaluator: evaluatorsById.get(attachment.evaluatorId),
      }),
    );
  }

  await deps.recordEvaluations({
    tenantId: projectId,
    scenarioRunId,
    evaluations,
    occurredAt: Date.now(),
  });
  logger.info(
    {
      projectId,
      scenarioRunId,
      evaluationCount: evaluations.length,
      statuses: evaluations.map((evaluation) => evaluation.status),
    },
    "Scenario run evaluations recorded",
  );
  return evaluations;
}
