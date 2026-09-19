/** Runs scenario evaluators for a finished run and records their results. */

import {
  CODE_EVALUATOR_CHECK_PREFIX,
  type EvaluatorWithFields,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { generate,KSUID_RESOURCES } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { type Span, type Trace } from "@langwatch/trace-contract";

import { evaluatorInputSpecsOf, type EvaluatorAttachment } from "../evaluator-attachments.ts";
import {
  type RunEvaluatorDefinition,
  type RunEvaluators,
  runEvaluatorDefinitionOf,
} from "../scenario-run-evaluators.ts";
import type { Scenario } from "../scenario.ts";
import type { ScenarioEvaluationResult } from "../schemas/event-schemas.ts";
import type { RecordEvaluationsCommandData } from "../simulation.commands.ts";
import { parseScenarioFieldValues, type ScenarioFieldValues } from "../suite-fields.ts";
import {
  attachmentsReadTrace,
  type ConversationMessage,
  type ResolvedValue,
  type RunInputs,
  resolveAttachmentInputs,
  type ScenarioInputs,
  storedInputsOf,
} from "./resolveScenarioMappings.ts";
import type { ScenarioEvaluationsJobPayload } from "./types.ts";

const logger = createLogger("langwatch:scenarios:evaluations");

/**
 * What the evaluator dispatch is handed, in the runner's own terms. Mirrors
 * `@langwatch/evaluation-process`'s internal `DataForEvaluation` shape, which
 * is not part of that package's public contract.
 */
export type DataForEvaluation =
  | { type: "default"; data: Record<string, unknown> }
  | { type: "custom"; data: Record<string, unknown> };

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
    }): Promise<Pick<Scenario, "id" | "situation" | "criteria" | "fields" | "testSuiteId"> | null>;
  };
  suites: {
    getRunAttachments: (params: {
      projectId: string;
      suiteId?: string | null;
      planId?: string | null;
    }) => Promise<EvaluatorAttachment[]>;
    getAttachedEvaluators: (params: {
      projectId: string;
      attachments: readonly Pick<EvaluatorAttachment, "evaluatorId">[];
    }) => Promise<Map<string, EvaluatorWithFields>>;
  };
  runs: {
    getRunState(params: {
      tenantId: string;
      scenarioRunId: string;
    }): Promise<ScenarioRunState | null>;
  };
  spans: {
    getSpansByTraceId: (params: { tenantId: string; traceId: string }) => Promise<Span[]>;
  };
  /** The shared evaluation runner (`runEvaluation`). */
  runEvaluation: (params: {
    projectId: string;
    evaluatorType: string;
    data: DataForEvaluation;
    settings?: Record<string, unknown>;
    trace?: Trace;
    workflowId?: string | null;
  }) => Promise<SingleEvaluationResult>;
  /** Writes one evaluation on a trace, so it shows in the trace drawer. */
  reportEvaluation: (report: TraceEvaluationReport) => Promise<void>;
  /** The record evaluations command of the simulation pipeline. */
  recordEvaluations: (data: RecordEvaluationsCommandData) => Promise<void>;
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

/** Loads evaluators, attachments, field values, and evaluator definitions
 * for a run; fixed at queue time before execution.
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
  return new Map([...saved].map(([id, evaluator]) => [id, runEvaluatorDefinitionOf(evaluator)]));
}

/**
 * The evaluator type the runner dispatches on: a workflow evaluator runs as
 * its workflow, a code evaluator as its own id, a built-in as the type its
 * config names.
 */
export function checkTypeOf(
  evaluator: Pick<RunEvaluatorDefinition, "id" | "type" | "workflowId" | "evaluatorType">,
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
  if (checkType.startsWith("custom/") || checkType.startsWith(CODE_EVALUATOR_CHECK_PREFIX)) {
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
    nowInstant().epochMilliseconds,
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
): Pick<ScenarioEvaluationResult, "status" | "passed" | "score" | "label" | "details" | "cost"> {
  // The runner spells an absent value as null; the stored result leaves it out.
  let status: ScenarioEvaluationResult["status"] = "scored";
  if (result.passed != null) {
    status = result.passed ? "passed" : "failed";
  }
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
    ...(result.status !== "error" && result.details !== undefined && { details: result.details }),
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
    traceIds.map((traceId) => deps.spans.getSpansByTraceId({ tenantId, traceId })),
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
    return errorResult(error instanceof Error ? error.message : "The evaluator failed to run");
  }
}

/**
 * One attachment after its mappings resolved and before any evaluator runs:
 * settled with a result recorded without running (evaluator gone, an input
 * skipped or failed), waiting on trace data, or ready to run with its inputs.
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
  const occurredAt = nowInstant().epochMilliseconds;
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
 * The results of every attachment, in order. Every attachment resolves
 * before any evaluator runs: one still waiting on its trace throws first on
 * any attempt but the last, so a retry never re-runs an evaluator.
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
    if (entry.kind === "pending") throw new TraceDataPendingError(entry.details);
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
 * The context every attachment of a run is graded against: its messages and
 * spans, the scenario's text and field values, and the trace an evaluator
 * that reads one is handed. Spans load only when something reads the trace.
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
  const traceIds = [...new Set([...payload.traceIds, ...(runState?.traceIds ?? [])])];
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

/** Runs evaluators for a finished run; throws TraceDataPendingError if trace
 * is missing on non-final attempts, records missing data as failed on final.
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
  // The job carries the attachments, field values and evaluator definitions
  // the run was queued with, so an edit made while the run executed cannot
  // change what it is graded against, and a retry matches the first attempt.
  const attachments =
    payload.attachments ??
    (await deps.suites.getRunAttachments({
      projectId,
      suiteId: scenario.testSuiteId,
      planId,
    }));
  if (attachments.length === 0) return [];
  const fieldValues = payload.fieldValues ?? parseScenarioFieldValues(scenario.fields);

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
    occurredAt: nowInstant().epochMilliseconds,
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
