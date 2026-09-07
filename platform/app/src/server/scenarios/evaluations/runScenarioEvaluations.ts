/**
 * Runs the evaluators attached to a finished scenario run and records their
 * results on the run.
 *
 * The worker behind the scenario evaluations job. It loads the scenario and
 * the run's own state, takes the attachments, the scenario's field values and
 * the evaluator definitions the job carries, resolves every mapping, runs
 * each evaluator through the shared evaluation runner, writes each evaluation
 * that ran on the run's last trace, and records one result per attachment
 * through the record evaluations command, which applies the gate.
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
import {
  type RunEvaluatorDefinition,
  type RunEvaluators,
  runEvaluatorDefinitionOf,
} from "../scenario-run-evaluators";
import type { ScenarioEvaluationResult } from "../schemas/event-schemas";
import {
  parseScenarioFieldValues,
  type ScenarioFieldValues,
} from "../suite-fields";
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
 * The evaluators one run is graded with: the attachments of its suite and its
 * plan, the scenario's field values the mappings read and the definition of
 * every attached evaluator the project holds.
 *
 * Read when the run is queued, so what the run is graded with is fixed
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
  const definitions =
    attachments.length === 0
      ? []
      : [...(await loadDefinitions({ deps, projectId, attachments })).values()];
  return {
    suiteId,
    planId,
    attachments,
    fieldValues: parseScenarioFieldValues(scenario?.fields),
    definitions,
  };
}

/** The saved evaluators the attachments name, as the worker keeps them. */
async function loadDefinitions({
  deps,
  projectId,
  attachments,
}: {
  deps: Pick<RunScenarioEvaluationsDeps, "suites">;
  projectId: string;
  attachments: readonly EvaluatorAttachment[];
}): Promise<Map<string, RunEvaluatorDefinition>> {
  const saved = await deps.suites.getAttachedEvaluators({
    projectId,
    attachments,
  });
  return new Map(
    [...saved].map(([id, evaluator]) => [
      id,
      runEvaluatorDefinitionOf(evaluator),
    ]),
  );
}

/**
 * The evaluator type the runner dispatches on: a workflow evaluator runs as
 * its workflow, a code evaluator as its own id, a built-in as the type its
 * config names.
 */
export function checkTypeOf(
  evaluator: Pick<
    RunEvaluatorDefinition,
    "id" | "type" | "workflowId" | "evaluatorType"
  >,
): string | null {
  if (evaluator.type === "workflow" && evaluator.workflowId) {
    return `custom/${evaluator.workflowId}`;
  }
  if (evaluator.type === "code") {
    return `${CODE_EVALUATOR_CHECK_PREFIX}${evaluator.id}`;
  }
  return evaluator.evaluatorType;
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
  evaluator: RunEvaluatorDefinition;
  checkType: string;
  data: Record<string, ResolvedValue>;
}): Promise<SingleEvaluationResult> {
  try {
    return await deps.runEvaluation({
      projectId: context.projectId,
      evaluatorType: checkType,
      data: dataForEvaluation({ checkType, data }),
      settings: evaluator.settings,
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
 * One attachment after its mappings resolved and before any evaluator runs:
 * settled with the result it records without running (its evaluator is
 * gone, an input is skipped or failed), waiting on trace data that has not
 * arrived, or ready to run with its inputs.
 */
type PreparedAttachment =
  | { kind: "settled"; result: ScenarioEvaluationResult }
  | { kind: "pending"; details: string }
  | {
      kind: "ready";
      attachment: EvaluatorAttachment;
      evaluator: RunEvaluatorDefinition;
      checkType: string;
      data: Record<string, ResolvedValue>;
    };

/** Resolves one attachment's inputs; runs nothing. */
function prepareAttachment({
  context,
  attachment,
  evaluator,
}: {
  context: RunContext;
  attachment: EvaluatorAttachment;
  evaluator: RunEvaluatorDefinition | undefined;
}): PreparedAttachment {
  const name = evaluator?.name ?? attachment.evaluatorId;
  const settle = (result: SingleEvaluationResult): PreparedAttachment => ({
    kind: "settled",
    result: toScenarioEvaluationResult({
      attachment,
      name,
      result,
      inputs: {},
    }),
  });

  if (!evaluator) {
    return settle(errorResult("The evaluator was not found in this project"));
  }
  const checkType = checkTypeOf(evaluator);
  if (!checkType) {
    return settle(errorResult("The evaluator names no evaluator type"));
  }

  const resolved = resolveAttachmentInputs({
    attachment,
    inputs: evaluatorInputSpecsOf(evaluator),
    run: context.run,
    scenario: context.scenario,
    isFinalAttempt: context.isFinalAttempt,
  });
  if (resolved.kind === "pending" && !context.isFinalAttempt) {
    return { kind: "pending", details: resolved.details };
  }
  if (resolved.kind === "skipped") {
    return settle({ status: "skipped", details: resolved.details });
  }
  if (resolved.kind !== "ready") {
    return settle({
      status: "processed",
      passed: false,
      details: resolved.details,
    });
  }
  return {
    kind: "ready",
    attachment,
    evaluator,
    checkType,
    data: resolved.data,
  };
}

/**
 * Runs one ready attachment and records the evaluator's own verdict, which
 * is also written on the run's last trace.
 */
async function executeAttachment({
  deps,
  context,
  ready,
}: {
  deps: Pick<RunScenarioEvaluationsDeps, "runEvaluation" | "reportEvaluation">;
  context: RunContext;
  ready: Extract<PreparedAttachment, { kind: "ready" }>;
}): Promise<ScenarioEvaluationResult> {
  const { attachment, evaluator, checkType, data } = ready;
  const occurredAt = Date.now();
  const result = await runOne({ deps, context, evaluator, checkType, data });
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
          inputs: data,
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
  return toScenarioEvaluationResult({
    attachment,
    name: evaluator.name,
    result,
    inputs: storedInputsOf(data),
  });
}

/**
 * The results of every attachment, in order. Every attachment is resolved
 * before any evaluator runs: on any attempt but the last, one attachment
 * still waiting on its trace throws before a single evaluator executes, so
 * a retry never runs an evaluator a second time. On the last attempt every
 * attachment is settled or ready and all of them run.
 */
async function evaluateAttachments({
  deps,
  context,
  attachments,
  evaluatorsById,
}: {
  deps: Pick<RunScenarioEvaluationsDeps, "runEvaluation" | "reportEvaluation">;
  context: RunContext;
  attachments: readonly EvaluatorAttachment[];
  evaluatorsById: ReadonlyMap<string, RunEvaluatorDefinition>;
}): Promise<ScenarioEvaluationResult[]> {
  const prepared = attachments.map((attachment) => {
    const entry = prepareAttachment({
      context,
      attachment,
      evaluator: evaluatorsById.get(attachment.evaluatorId),
    });
    if (entry.kind === "pending")
      throw new TraceDataPendingError(entry.details);
    return entry;
  });

  const evaluations: ScenarioEvaluationResult[] = [];
  for (const entry of prepared) {
    evaluations.push(
      entry.kind === "ready"
        ? await executeAttachment({ deps, context, ready: entry })
        : entry.result,
    );
  }
  return evaluations;
}

/**
 * The context every attachment of one run is graded against: the run's own
 * messages and spans, the scenario's text and field values, and the trace an
 * evaluator that reads one is handed. The spans are loaded only when an
 * attachment reads the trace.
 */
async function buildRunContext({
  deps,
  payload,
  scenario,
  fieldValues,
  attachments,
  runState,
  isFinalAttempt,
}: {
  deps: RunScenarioEvaluationsDeps;
  payload: ScenarioEvaluationsJobPayload;
  scenario: Pick<Scenario, "situation" | "criteria">;
  fieldValues: ScenarioFieldValues;
  attachments: readonly EvaluatorAttachment[];
  runState: ScenarioRunState | null;
  isFinalAttempt: boolean;
}): Promise<RunContext> {
  const { tenantId: projectId, scenarioRunId } = payload;
  const traceIds = [
    ...new Set([...payload.traceIds, ...(runState?.traceIds ?? [])]),
  ];
  const spans = attachmentsReadTrace(attachments)
    ? await loadSpans({ deps, tenantId: projectId, traceIds })
    : [];
  const lastTraceId = traceIds.at(-1);
  return {
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
      fields: fieldValues,
    },
    lastTraceId,
    trace: traceForEvaluation({ projectId, traceId: lastTraceId, spans }),
    isFinalAttempt,
  };
}

/**
 * Runs the evaluators of one finished run and records the results.
 *
 * Every attachment's inputs are resolved before any evaluator runs. On any
 * attempt but the last, a trace that has not arrived throws
 * `TraceDataPendingError` before a single evaluator executes and before
 * anything is recorded, so the whole run is graded in one go once the data
 * is there and no evaluator is paid for twice. On the last attempt the
 * missing data is recorded as a failed result with its reason and every
 * other evaluator runs.
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
  // The job carries the attachments, the scenario's field values and the
  // evaluator definitions the run was queued with, so a suite, a plan, a
  // scenario or an evaluator edited while the run executed does not change
  // what it is graded against, and a retry grades exactly what the first
  // attempt would have. A payload written before they were carried reads
  // them now instead.
  const attachments =
    payload.attachments ??
    (await deps.suites.getRunAttachments({
      projectId,
      suiteId: scenario.testSuiteId,
      planId,
    }));
  if (attachments.length === 0) return [];
  const fieldValues =
    payload.fieldValues ?? parseScenarioFieldValues(scenario.fields);

  const [evaluatorsById, runState] = await Promise.all([
    payload.definitions
      ? new Map(payload.definitions.map((entry) => [entry.id, entry]))
      : loadDefinitions({ deps, projectId, attachments }),
    deps.runs.getRunState({ tenantId: projectId, scenarioRunId }),
  ]);

  const context = await buildRunContext({
    deps,
    payload,
    scenario,
    fieldValues,
    attachments,
    runState,
    isFinalAttempt,
  });

  const evaluations = await evaluateAttachments({
    deps,
    context,
    attachments,
    evaluatorsById,
  });

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
