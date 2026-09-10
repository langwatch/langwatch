import type { Command } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import type {
  EvaluationExecutionResult,
  EvaluationRunData,
  ExecuteEvaluationCommandData,
  EvaluationSummary,
  MonitorPerformanceQuery,
  OnlineEvaluationPerformance,
  TraceEvaluationData,
} from "@langwatch/evaluation-contract";
import {
  executeEvaluationCommandDataSchema,
  EXECUTE_EVALUATION_COMMAND_TYPE,
  type ExecuteEvaluationCommand as ExecuteEvaluationInput,
} from "@langwatch/evaluation-contract";
import type { MonitorIdInput, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { monitorWithEvaluatorSchema } from "@langwatch/monitor-contract";
import type {
  EvaluationTraceEvent,
  EvaluationTraceSpan,
  TraceFullReadInput,
  TraceFullRecord,
  TraceFullThreadReadInput,
  SpanTreeDeltaInput,
  SpanTreeNode,
  SpanTreeInput,
  SpanTreePage,
  TraceIngestWaitInput,
  TraceQueryFieldCatalogueInput,
  TraceSummaryData,
  TraceSummaryLookupInput,
} from "@langwatch/trace-contract";
import { TraceService } from "@langwatch/trace-contract";
import { vi } from "vitest";
import {
  EvaluationCostRecorderPort,
  EvaluationExecutionReceiptPort,
  type ExecuteEvaluationCommandDeps,
} from "../../evaluation.port.ts";
import { EvaluationMonitorLookupPort } from "../../evaluation-execution.port.ts";

export function buildExecuteCommand(
  overrides: Partial<ExecuteEvaluationCommandData> = {},
): Command<ExecuteEvaluationCommandData> {
  const data = executeEvaluationCommandDataSchema.parse({
    tenantId: "project-evaluation-test",
    traceId: "trace-evaluation-test",
    evaluationId: "evaluation-test",
    evaluatorId: "monitor-test",
    evaluatorType: "custom/test",
    occurredAt: 1_700_000_000_000,
    ...overrides,
  });

  return {
    tenantId: createTenantId(data.tenantId),
    aggregateId: data.evaluationId,
    type: EXECUTE_EVALUATION_COMMAND_TYPE,
    data,
  };
}

export function buildMonitor(overrides: Record<string, unknown> = {}): MonitorWithEvaluator {
  const { evaluator: evaluatorOverride, ...monitorOverrides } = overrides;
  const evaluator =
    evaluatorOverride === undefined
      ? null
      : evaluatorOverride !== null && typeof evaluatorOverride === "object"
        ? {
            id: "evaluator-test",
            projectId: "project-evaluation-test",
            name: "Test evaluator",
            slug: "test-evaluator",
            type: "evaluator",
            config: {},
            workflowId: null,
            copiedFromEvaluatorId: null,
            archivedAt: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            ...evaluatorOverride,
          }
        : evaluatorOverride;

  return monitorWithEvaluatorSchema.parse({
    id: "monitor-test",
    projectId: "project-evaluation-test",
    experimentId: null,
    evaluatorId: null,
    checkType: "custom/test",
    name: "Test monitor",
    slug: "test-monitor",
    executionMode: "MANUALLY",
    enabled: true,
    preconditions: [],
    parameters: {},
    mappings: null,
    sample: 1,
    level: "trace",
    threadIdleTimeout: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...monitorOverrides,
    evaluator,
  });
}

/**
 * The one monitor read an execution makes. Narrowed to
 * {@link EvaluationMonitorLookupPort}: everything else a monitor can answer
 * belongs to the monitor feature's own tests.
 */
export class TestMonitorLookup extends EvaluationMonitorLookupPort {
  readonly tryGetMonitorById = vi.fn(
    async (_input: MonitorIdInput): Promise<MonitorWithEvaluator | null> => this.monitor,
  );

  constructor(private readonly monitor: MonitorWithEvaluator | null) {
    super();
  }
}

export class TestTraceService extends TraceService {
  classifyQuery() {
    return { evaluations: false, events: false, spans: false };
  }

  async getById(): Promise<never> {
    throw new Error("unused trace capability");
  }

  async getFullRecord(input: TraceFullReadInput): Promise<TraceFullRecord> {
    throw new Error(`unused trace full-record capability: ${input.traceId}`);
  }

  async getFullThread(_input: TraceFullThreadReadInput): Promise<TraceFullRecord[]> {
    return [];
  }

  async deriveEvents(): Promise<never> {
    throw new Error("unused trace capability");
  }

  readonly getEvaluationSpans = vi.fn(
    async (_input: {
      tenantId: string;
      traceId: string;
      occurredAtMs?: number;
    }): Promise<EvaluationTraceSpan[]> => [],
  );

  readonly getEvaluationEvents = vi.fn(
    async (_input: {
      tenantId: string;
      traceId: string;
      occurredAtMs?: number;
    }): Promise<EvaluationTraceEvent[]> => [],
  );

  async getSpanTreePage(_input: SpanTreeInput): Promise<SpanTreePage> {
    throw new Error("unused trace capability");
  }

  async getSpanTreeDelta(_input: SpanTreeDeltaInput): Promise<SpanTreeNode[]> {
    return [];
  }

  async buildQueryFieldCatalogue(_input: TraceQueryFieldCatalogueInput): Promise<string> {
    throw new Error("unused trace capability");
  }

  async resolveIngestWaitTimeout(_input: TraceIngestWaitInput): Promise<number> {
    return 0;
  }

  async tryGetSummary(_input: TraceSummaryLookupInput): Promise<TraceSummaryData | null> {
    return null;
  }
}

export class TestEvaluationService {
  readonly executeForTrace = vi.fn(
    async (_input: ExecuteEvaluationInput): Promise<EvaluationExecutionResult> => ({
      status: "processed",
      score: 1,
      passed: true,
    }),
  );

  async upsertRun(_input: never): Promise<void> {}

  async upsertRuns(_input: never): Promise<void> {}

  async getRunByEvaluationId(_input: never): Promise<EvaluationRunData> {
    throw new Error("unused evaluation capability");
  }

  async tryGetRunByEvaluationId(_input: never): Promise<EvaluationRunData | null> {
    return null;
  }

  async findRunsByTraceId(_input: never): Promise<EvaluationRunData[]> {
    return [];
  }

  async findSummariesByTraceIds(_input: never): Promise<Record<string, EvaluationSummary[]>> {
    return {};
  }

  async findTraceEvaluations(_input: never): Promise<Record<string, TraceEvaluationData[]>> {
    return {};
  }

  async tryGetInputs(_input: never): Promise<Record<string, unknown> | null> {
    return null;
  }

  async getMonitorPerformance(
    _input: MonitorPerformanceQuery,
  ): Promise<OnlineEvaluationPerformance[]> {
    return [];
  }
}

export class TestCostRecorder extends EvaluationCostRecorderPort {
  readonly created = vi.fn();
  private readonly costs = new Map<string, string>();

  readonly recordCost = vi.fn(
    async (_input: {
      projectId: string;
      isGuardrail: boolean;
      evaluatorName: string;
      evaluatorId: string;
      traceId: string;
      idempotencyKey: string;
      amount: number;
      currency: string;
    }): Promise<string> => {
      const existing = this.costs.get(_input.idempotencyKey);
      if (existing) return existing;

      const costId = `evaluation-cost:${_input.idempotencyKey}`;
      this.costs.set(_input.idempotencyKey, costId);
      this.created(_input);
      return costId;
    },
  );
}

/** In-memory receipt boundary used to make redelivery observable in unit tests. */
export class TestEvaluationExecutionReceipt extends EvaluationExecutionReceiptPort {
  readonly calls = vi.fn();

  async execute(input: {
    tenantId: string;
    evaluationId: string;
    operationKey: string;
    command: ExecuteEvaluationInput;
    cost: {
      isGuardrail: boolean;
      evaluatorName: string;
      evaluatorId: string;
      traceId: string;
    };
  }): Promise<{ result: EvaluationExecutionResult; costId: string | null }> {
    this.calls(input);
    const cached = this.outcomes.get(input.evaluationId);
    if (cached) return cached;

    const result = await this.evaluations.executeForTrace(input.command);
    const costId =
      result.status === "processed" && result.cost
        ? await this.costRecorder.recordCost({
            projectId: input.tenantId,
            isGuardrail: input.cost.isGuardrail,
            evaluatorName: input.cost.evaluatorName,
            evaluatorId: input.cost.evaluatorId,
            traceId: input.cost.traceId,
            idempotencyKey: `${input.operationKey}:cost`,
            amount: result.cost.amount,
            currency: result.cost.currency,
          })
        : null;
    const outcome = { result, costId };
    this.outcomes.set(input.evaluationId, outcome);
    return outcome;
  }

  constructor(
    private readonly evaluations: TestEvaluationService,
    private readonly costRecorder: TestCostRecorder,
    private readonly outcomes = new Map<
      string,
      { result: EvaluationExecutionResult; costId: string | null }
    >(),
  ) {
    super();
  }
}

export interface EvaluationExecutionFixtureOptions {
  monitor?: MonitorWithEvaluator | null;
  executionResult?: EvaluationExecutionResult;
  executionError?: Error;
  azureCredentials?: Record<string, string> | null;
  settingsRecoveryDisabled?: () => Promise<boolean>;
}

export function buildExecutionDeps(
  options: EvaluationExecutionFixtureOptions = {},
): ExecuteEvaluationCommandDeps & {
  monitors: TestMonitorLookup;
  traces: TestTraceService;
  evaluations: TestEvaluationService;
  costRecorder: TestCostRecorder;
  executionReceipt: TestEvaluationExecutionReceipt;
} {
  const monitors = new TestMonitorLookup(options.monitor ?? buildMonitor());
  const traces = new TestTraceService();
  const evaluations = new TestEvaluationService();
  if (options.executionResult)
    evaluations.executeForTrace.mockResolvedValue(options.executionResult);
  if (options.executionError) evaluations.executeForTrace.mockRejectedValue(options.executionError);
  const costRecorder = new TestCostRecorder();
  const executionReceipt = new TestEvaluationExecutionReceipt(evaluations, costRecorder);
  const azureSafetyCredentials = vi.fn(
    async (_input: { tenantId: string }): Promise<Record<string, string> | null> =>
      options.azureCredentials ?? null,
  );

  return {
    monitors,
    traces,
    executionReceipt,
    azureSafetyCredentials: {
      tryGetForTenant: azureSafetyCredentials,
    },
    settingsRecovery: {
      isDisabled: options.settingsRecoveryDisabled ?? (async () => false),
    },
    inputsOffload: {
      offload: async ({ inputs }) => inputs,
    },
    evaluations,
    costRecorder,
  };
}
