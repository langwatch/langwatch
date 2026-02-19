import type { LangEvalsClient } from "../clients/langevals/langevals.client";
import { NullLangevalsClient } from "../clients/langevals/langevals.client";
import { LangEvalsHttpClient } from "../clients/langevals/langevals.http.client";
import { traced } from "../tracing";
import type { PrismaClient } from "@prisma/client";
import { env } from "~/env.mjs";
import { prisma as defaultPrisma } from "~/server/db";
import {
  DEFAULT_MAPPINGS,
  migrateLegacyMappings,
} from "~/server/evaluations/evaluationMappings";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "~/server/evaluations/evaluators.generated";
import { createCostChecker } from "~/server/license-enforcement/license-enforcement.repository";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import {
  type MappingState,
  mapTraceToDatasetEntry,
  SERVER_ONLY_THREAD_SOURCES,
  SERVER_ONLY_TRACE_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
} from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";
import { runEvaluationWorkflow } from "~/server/workflows/runWorkflow";
import {
  createDefaultModelEnvResolver,
  createDefaultTraceFetcher,
} from "./evaluation-execution.factories";
import {
  CostLimitExceededError,
  EvaluatorConfigError,
  EvaluatorNotFoundError,
  TraceNotEvaluatableError,
} from "./errors";
import type { EvaluationExecutionResult } from "./evaluation-execution.types";

// ---------------------------------------------------------------------------
// Dependency interfaces (colocated — not shared)
// ---------------------------------------------------------------------------

export interface EvaluationExecutionDeps {
  traceFetcher: TraceFetcher;
  costChecker: CostChecker;
  modelEnvResolver: ModelEnvResolver;
  workflowExecutor: WorkflowExecutor;
  projectFetcher: ProjectFetcher;
}

export interface TraceFetcher {
  getTraceById(params: {
    projectId: string;
    traceId: string;
  }): Promise<Trace | undefined>;

  getTracesGroupedByThreadId(params: {
    projectId: string;
    threadId: string;
  }): Promise<Trace[]>;
}

export interface CostChecker {
  maxMonthlyUsageLimit(organizationId: string): Promise<number>;
  getCurrentMonthCost(organizationId: string): Promise<number>;
}

export interface ModelEnvResolver {
  resolveForEvaluator(params: {
    evaluatorType: EvaluatorTypes;
    evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
    projectId: string;
    settings?: Record<string, unknown>;
  }): Promise<Record<string, string>>;
}

export interface WorkflowExecutor {
  runEvaluationWorkflow(
    workflowId: string,
    projectId: string,
    inputs: Record<string, string>,
  ): Promise<{ result: SingleEvaluationResult; status: string }>;
}

export interface ProjectFetcher {
  getProjectWithTeam(projectId: string): Promise<{
    id: string;
    team: { organizationId: string };
  } | null>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type DataForEvaluation =
  | { type: "default"; data: Record<string, unknown> }
  | { type: "custom"; data: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EvaluationExecutionService {
  constructor(
    private readonly langevalsClient: LangEvalsClient,
    private readonly deps: EvaluationExecutionDeps,
  ) {}

  static create(prisma?: PrismaClient): EvaluationExecutionService {
    const p = prisma ?? defaultPrisma;
    const client = env.LANGEVALS_ENDPOINT
      ? new LangEvalsHttpClient(env.LANGEVALS_ENDPOINT)
      : new NullLangevalsClient();

    const deps: EvaluationExecutionDeps = {
      traceFetcher: createDefaultTraceFetcher(p),
      costChecker: createCostChecker(p),
      modelEnvResolver: createDefaultModelEnvResolver(),
      workflowExecutor: { runEvaluationWorkflow },
      projectFetcher: {
        getProjectWithTeam: async (projectId: string) => {
          return p.project.findUnique({
            where: { id: projectId, archivedAt: null },
            include: { team: true },
          });
        },
      },
    };

    return traced(
      new EvaluationExecutionService(client, deps),
      "EvaluationExecutionService",
    );
  }

  async executeForTrace(params: {
    projectId: string;
    traceId: string;
    evaluatorType: string;
    settings: Record<string, unknown> | string | number | boolean | null;
    mappings: MappingState | null;
    level?: "trace" | "thread";
    workflowId?: string | null;
  }): Promise<EvaluationExecutionResult> {
    const {
      projectId,
      traceId,
      evaluatorType,
      settings,
      mappings,
      level,
      workflowId,
    } = params;

    // 1. Fetch trace
    const trace = await this.deps.traceFetcher.getTraceById({
      projectId,
      traceId,
    });

    if (!trace) {
      throw new TraceNotEvaluatableError(traceId);
    }

    // 2. Validate trace is evaluatable
    if (trace.error && !trace.input && !trace.output) {
      return {
        status: "skipped",
        details: "Cannot evaluate trace with errors",
      };
    }

    // 3. Determine evaluation level
    const isThreadLevel = level
      ? level === "thread"
      : hasThreadMappings(mappings);

    const evaluationThreadId =
      isThreadLevel && trace.metadata?.thread_id
        ? trace.metadata.thread_id
        : undefined;

    // 4. Build evaluation data
    const data = await this.buildDataForEvaluation({
      evaluatorType,
      trace,
      mappings,
      isThreadLevel,
      projectId,
    });

    // 5. Execute evaluation
    const normalizedSettings =
      settings && typeof settings === "object" ? settings : undefined;

    const result = await this.runEvaluation({
      projectId,
      evaluatorType,
      data,
      settings: normalizedSettings,
      trace,
      workflowId,
    });

    return {
      status: result.status,
      score: result.status === "processed" ? result.score : undefined,
      passed: result.status === "processed" ? result.passed : undefined,
      label: result.status === "processed" ? result.label : undefined,
      details: "details" in result ? result.details : undefined,
      cost:
        result.status === "processed" && "cost" in result && result.cost
          ? result.cost
          : undefined,
      evaluationThreadId,
      inputs: data.data as Record<string, unknown>,
    };
  }

  // ---------------------------------------------------------------------------
  // Data building (reuses existing mapping functions)
  // ---------------------------------------------------------------------------

  private async buildDataForEvaluation(params: {
    evaluatorType: string;
    trace: Trace;
    mappings: MappingState | null;
    isThreadLevel: boolean;
    projectId: string;
  }): Promise<DataForEvaluation> {
    const { evaluatorType, trace, mappings, isThreadLevel, projectId } = params;

    let data: Record<string, unknown>;

    if (isThreadLevel) {
      data = await this.buildThreadData(projectId, trace, mappings);
    } else {
      const mappedData = switchMapping(trace, mappings ?? DEFAULT_MAPPINGS);
      if (!mappedData) {
        throw new TraceNotEvaluatableError(trace.trace_id);
      }

      // Fill in server-only trace sources
      if (mappings?.mapping) {
        for (const [field, config] of Object.entries(mappings.mapping)) {
          if (
            "source" in config &&
            (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(config.source)
          ) {
            if (config.source === "formatted_trace") {
              (mappedData as Record<string, unknown>)[field] = await formatSpansDigest(trace.spans ?? []);
            }
          }
        }
      }

      data = mappedData as Record<string, unknown>;
    }

    // Workflow/custom evaluators pass data through as-is
    if (evaluatorType.startsWith("custom/") || evaluatorType === "workflow") {
      return { type: "custom", data };
    }

    const evaluator = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
    if (!evaluator) {
      throw new EvaluatorNotFoundError(evaluatorType);
    }

    const fields = [...evaluator.requiredFields, ...evaluator.optionalFields];
    const filtered = Object.fromEntries(
      fields.map((field) => [field, data[field] ?? ""]),
    );

    return { type: "default", data: filtered };
  }

  private async buildThreadData(
    projectId: string,
    trace: Trace,
    mappings: MappingState | null,
  ): Promise<Record<string, unknown>> {
    if (!mappings) {
      throw new EvaluatorConfigError(
        "Mapping state is required for thread-based evaluation",
      );
    }

    const threadId = trace.metadata?.thread_id;
    if (!threadId) {
      throw new EvaluatorConfigError(
        "Trace does not have a thread_id for thread-based evaluation",
      );
    }

    const threadTraces = await this.deps.traceFetcher.getTracesGroupedByThreadId({
      projectId,
      threadId,
    });

    const result: Record<string, unknown> = {};

    for (const [targetField, mappingConfig] of Object.entries(mappings.mapping)) {
      const isThreadMapping =
        ("type" in mappingConfig && mappingConfig.type === "thread") ||
        ("source" in mappingConfig &&
          (mappingConfig.source in THREAD_MAPPINGS ||
            (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(
              mappingConfig.source,
            )));

      if (isThreadMapping && "source" in mappingConfig) {
        const source = mappingConfig.source;
        if (!source) continue;

        if (
          (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)
        ) {
          if (source === "formatted_traces") {
            result[targetField] = (await Promise.all(threadTraces.map((t) => formatSpansDigest(t.spans ?? []))))
              .join("\n\n---\n\n");
          }
        } else {
          const threadSource = source as keyof typeof THREAD_MAPPINGS;
          const selectedFields =
            ("selectedFields" in mappingConfig
              ? mappingConfig.selectedFields
              : undefined) ?? [];
          result[targetField] = THREAD_MAPPINGS[threadSource].mapping(
            { thread_id: threadId, traces: threadTraces },
            selectedFields as (keyof typeof TRACE_MAPPINGS)[],
          );
        }
      } else if ("source" in mappingConfig) {
        // Regular trace mapping
        if (
          (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(
            mappingConfig.source,
          )
        ) {
          if (mappingConfig.source === "formatted_trace") {
            result[targetField] = await formatSpansDigest(trace.spans ?? []);
          }
        } else {
          const traceMappingConfig: { source: string; key?: string; subkey?: string } = {
            source: mappingConfig.source,
            key: mappingConfig.key,
            subkey: mappingConfig.subkey,
          };
          const mapped = mapTraceToDatasetEntry(
            trace,
            { [targetField]: traceMappingConfig },
            new Set(),
            undefined,
            undefined,
          )[0];
          result[targetField] = mapped?.[targetField];
        }
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Evaluation execution (built-in vs custom/workflow)
  // ---------------------------------------------------------------------------

  private async runEvaluation(params: {
    projectId: string;
    evaluatorType: string;
    data: DataForEvaluation;
    settings?: Record<string, unknown>;
    trace?: Trace;
    workflowId?: string | null;
  }): Promise<SingleEvaluationResult> {
    const { projectId, evaluatorType, data, settings, trace, workflowId } = params;

    // Cost limit check
    const project = await this.deps.projectFetcher.getProjectWithTeam(projectId);
    if (!project) {
      throw new EvaluatorConfigError("Project not found");
    }

    const maxMonthlyUsage = await this.deps.costChecker.maxMonthlyUsageLimit(
      project.team.organizationId,
    );
    const currentCost = await this.deps.costChecker.getCurrentMonthCost(
      project.team.organizationId,
    );
    if (currentCost >= maxMonthlyUsage) {
      throw new CostLimitExceededError(project.team.organizationId);
    }

    // Custom/workflow evaluators
    if (data.type === "custom") {
      return this.runCustomEvaluation(projectId, evaluatorType, data.data, trace, workflowId);
    }

    // Built-in evaluators
    const builtInType = evaluatorType as EvaluatorTypes;
    const evaluator = AVAILABLE_EVALUATORS[builtInType];
    if (!evaluator) {
      throw new EvaluatorNotFoundError(evaluatorType);
    }

    const evaluatorEnv = await this.deps.modelEnvResolver.resolveForEvaluator({
      evaluatorType: builtInType,
      evaluator,
      projectId,
      settings,
    });

    return this.langevalsClient.evaluate({
      evaluatorType: builtInType,
      data: data.data,
      settings: settings ?? {},
      env: evaluatorEnv,
    });
  }

  private async runCustomEvaluation(
    projectId: string,
    evaluatorType: string,
    data: Record<string, unknown>,
    trace?: Trace,
    workflowId?: string | null,
  ): Promise<SingleEvaluationResult> {
    const resolvedWorkflowId = workflowId ?? evaluatorType.split("/")[1];

    if (!resolvedWorkflowId) {
      throw new EvaluatorConfigError("Workflow ID is required");
    }

    const requestBody: Record<string, unknown> = {
      trace_id: trace?.trace_id,
      do_not_trace: true,
      ...data,
    };

    const response = await this.deps.workflowExecutor.runEvaluationWorkflow(
      resolvedWorkflowId,
      projectId,
      requestBody as Record<string, string>,
    );

    if (response.status !== "success") {
      return { ...response.result, status: "error" } as SingleEvaluationResult;
    }

    return { ...response.result, status: "processed" };
  }

}

// ---------------------------------------------------------------------------
// Pure helper functions (moved from evaluationsWorker)
// ---------------------------------------------------------------------------

function hasThreadMappings(mappingState: MappingState | null): boolean {
  if (!mappingState) return false;
  return Object.values(mappingState.mapping).some(
    (mapping) => "type" in mapping && mapping.type === "thread",
  );
}

function switchMapping(
  trace: Trace,
  mapping_: MappingState,
): Record<string, string | number> | undefined {
  const mapping: MappingState =
    "mapping" in mapping_
      ? mapping_
      : migrateLegacyMappings(mapping_ as unknown as Record<string, string>);

  return mapTraceToDatasetEntry(
    trace,
    mapping.mapping as Record<
      string,
      {
        source: string;
        key?: string;
        subkey?: string;
      }
    >,
    new Set(),
    undefined,
    undefined,
  )[0];
}

