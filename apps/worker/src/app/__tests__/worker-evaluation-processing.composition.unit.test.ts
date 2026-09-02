import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import {
  EvaluationCostRecorderPort,
  EvaluationLangevalsPort,
  EvaluationModelEnvPort,
  EvaluationSpanDigestPort,
  EvaluationTraceReadPort,
  EvaluationWorkflowExecutorPort,
  type EvaluationAzureSafetyCredentialsPort,
  type EvaluationInputsOffloadPort,
  type EvaluationMonitorLookupPort,
  type EvaluationSettingsRecoveryPort,
  type EvaluationTraceEvidencePort,
  type LangevalsEvaluateParams,
} from "@langwatch/evaluation-server";
import type { EvaluatorService, SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type { Trace } from "@langwatch/trace-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkerEvaluationProcessing,
  WorkerEvaluationAbsenceReportPort,
  type WorkerEvaluationExecutionCollaborators,
} from "../worker-evaluation-processing.composition";

/**
 * Spec: specs/monitors/online-evaluator-loop-prevention.feature
 *
 * A COMPOSITION-CAPABILITY test for the ONLINE evaluation path. Everything the
 * path touches outside this process — the monitor row, the trace, the model
 * provider's environment, the evaluator service — is a fake, and what is under
 * test is that `command:executeEvaluation` reaches the Langevals transport
 * carrying the data the trace mappings produced, and comes back as a reported
 * event. Before this composition the same command refused by name.
 */

const OCCURRED_AT = 1_760_000_000_000;

function traceFixture(): Trace {
  return {
    trace_id: "trace-1",
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: OCCURRED_AT, inserted_at: OCCURRED_AT, updated_at: OCCURRED_AT },
    input: { value: "what is the capital of France?" },
    output: { value: "Paris" },
    spans: [],
  } as unknown as Trace;
}

class FakeTraceReads extends EvaluationTraceReadPort {
  async getTracesWithSpans(): Promise<Trace[]> {
    return [traceFixture()];
  }

  async getEvaluationsMultiple(): Promise<Record<string, unknown[]>> {
    return {};
  }

  async getTracesWithSpansByThreadIds(): Promise<Trace[]> {
    return [];
  }
}

class RefusingSpanDigest extends EvaluationSpanDigestPort {
  format(): Promise<string> {
    return Promise.reject(new Error("no span digest in this test"));
  }
}

class StatedModelEnv extends EvaluationModelEnvPort {
  async resolveForEvaluator(): Promise<Record<string, string>> {
    return { OPENAI_API_KEY: "sk-test" };
  }
}

class RefusingWorkflowExecutor extends EvaluationWorkflowExecutorPort {
  runEvaluationWorkflow(): Promise<never> {
    return Promise.reject(new Error("no workflow runtime in this test"));
  }
}

class RecordingLangevals extends EvaluationLangevalsPort {
  readonly calls: LangevalsEvaluateParams[] = [];

  async evaluate(params: LangevalsEvaluateParams): Promise<SingleEvaluationResult> {
    this.calls.push(params);

    return {
      status: "processed",
      score: 0.75,
      passed: true,
      cost: { amount: 0.0002, currency: "USD" },
    } as SingleEvaluationResult;
  }
}

class RecordingCosts extends EvaluationCostRecorderPort {
  readonly written: Array<{ idempotencyKey: string; amount: number }> = [];

  async recordCost(params: { idempotencyKey: string; amount: number }): Promise<string> {
    this.written.push({ idempotencyKey: params.idempotencyKey, amount: params.amount });

    return `evaluation-cost:${params.idempotencyKey}`;
  }
}

const evaluators = {
  executeNative: vi.fn(),
  executeCode: vi.fn(),
  augmentResult: vi.fn(async (input: { result: SingleEvaluationResult }) => input.result),
} as unknown as EvaluatorService;

const monitors: EvaluationMonitorLookupPort = {
  tryGetMonitorById: async () => ({
    id: "monitor-1",
    projectId: "project-1",
    name: "Quality",
    checkType: "langevals/basic",
    sample: 1,
    enabled: true,
    preconditions: [],
    parameters: { prompt: "grade it" },
    mappings: null,
    level: "trace",
    evaluator: null,
  }),
} as unknown as EvaluationMonitorLookupPort;

const evidence: EvaluationTraceEvidencePort = {
  getEvaluationSpans: async () => [],
  getEvaluationEvents: async () => [],
} as unknown as EvaluationTraceEvidencePort;

const azureSafetyCredentials = {
  tryGetForTenant: async () => null,
} as unknown as EvaluationAzureSafetyCredentialsPort;

const settingsRecovery = {
  isDisabled: async () => false,
} as unknown as EvaluationSettingsRecoveryPort;

const inputsOffload = {
  offload: async (input: { inputs: Record<string, unknown> }) => input.inputs,
} as unknown as EvaluationInputsOffloadPort;

const analytics = {
  recordEvaluation: vi.fn(),
} as unknown as AnalyticsService;

function collaborators(
  langevals: RecordingLangevals,
  costs: RecordingCosts,
): WorkerEvaluationExecutionCollaborators {
  return {
    monitors,
    evidence,
    azureSafetyCredentials,
    settingsRecovery,
    inputsOffload,
    costs,
    engine: {
      traceService: new FakeTraceReads(),
      spanDigest: new RefusingSpanDigest(),
      modelEnvResolver: new StatedModelEnv(),
      langevalsClient: langevals,
      workflows: {} as unknown as WorkflowService,
      evaluators,
      workflowExecutor: new RefusingWorkflowExecutor(),
      installEnvironment: {},
    },
  };
}

function processingOptions(
  overrides: Partial<Parameters<typeof createWorkerEvaluationProcessing>[0]> = {},
): Parameters<typeof createWorkerEvaluationProcessing>[0] {
  return {
    resolveClickHouseClient: (async () => {
      throw new Error("no ClickHouse in this test");
    }) as unknown as Parameters<typeof createWorkerEvaluationProcessing>[0]["resolveClickHouseClient"],
    defaultRetentionDays: 49,
    analytics,
    traces: {} as unknown as Parameters<typeof createWorkerEvaluationProcessing>[0]["traces"],
    automation: {
      triggers: { getActiveTraceTriggers: async () => [] },
      graphActivity: { reevaluate: async () => undefined },
      triggerMatches: { record: async () => undefined },
    } as unknown as Parameters<typeof createWorkerEvaluationProcessing>[0]["automation"],
    ...overrides,
  };
}

function executeHandler(definition: {
  commands: Array<{ name: string; handlerInstance?: unknown }>;
}): { handle(command: unknown): Promise<Array<{ type: string }>> } {
  const registered = definition.commands.find((entry) => entry.name === "executeEvaluation");
  if (!registered?.handlerInstance) {
    throw new Error("executeEvaluation is not registered with an instance");
  }

  return registered.handlerInstance as { handle(command: unknown): Promise<Array<{ type: string }>> };
}

function command(): ExecuteEvaluationCommandData {
  return {
    tenantId: "project-1",
    traceId: "trace-1",
    evaluationId: "evaluation-1",
    evaluatorId: "monitor-1",
    evaluatorType: "langevals/basic",
    evaluatorName: "Quality",
    occurredAt: OCCURRED_AT,
  };
}

describe("given the worker composes evaluation processing", () => {
  describe("when the online execution collaborators are absent", () => {
    it("reports the absence and refuses the execute command by name", async () => {
      const reported: string[] = [];
      class Reporter extends WorkerEvaluationAbsenceReportPort {
        withoutEvaluatorExecution(): void {
          reported.push("execution");
        }

        withoutExecutionReceiptLedger(): void {
          reported.push("receipt");
        }
      }

      const capability = createWorkerEvaluationProcessing(
        processingOptions({ absence: new Reporter() }),
      );
      const definition = capability.buildProcessing();

      expect(reported).toEqual(["execution"]);
      await expect(
        executeHandler(definition as never).handle({ data: command() }),
      ).rejects.toThrow(/cannot run evaluator langevals\/basic/);
    });
  });

  describe("when the online execution collaborators are supplied", () => {
    it("carries an execute command through to the Langevals transport", async () => {
      const langevals = new RecordingLangevals();
      const costs = new RecordingCosts();
      const capability = createWorkerEvaluationProcessing(
        processingOptions({ execution: collaborators(langevals, costs) }),
      );

      const definition = capability.buildProcessing();
      const events = await executeHandler(definition as never).handle({ data: command() });

      expect(langevals.calls).toHaveLength(1);
      expect(langevals.calls[0]).toMatchObject({
        evaluatorType: "langevals/basic",
        settings: { prompt: "grade it" },
        env: { OPENAI_API_KEY: "sk-test" },
      });
      expect(langevals.calls[0]?.data).toMatchObject({
        input: "what is the capital of France?",
        output: "Paris",
      });
      expect(events.map((event) => event.type)).toContain("lw.evaluation.reported");
    });

    it("bills the run once, under the operation key the redelivery would reuse", async () => {
      const langevals = new RecordingLangevals();
      const costs = new RecordingCosts();
      const capability = createWorkerEvaluationProcessing(
        processingOptions({ execution: collaborators(langevals, costs) }),
      );

      const definition = capability.buildProcessing();
      const handler = executeHandler(definition as never);
      await handler.handle({ data: command() });
      await handler.handle({ data: command() });

      expect(costs.written.map((row) => row.idempotencyKey)).toEqual([
        "project-1:evaluation-1:execution",
        "project-1:evaluation-1:execution",
      ]);
    });

    it("names the receipt ledger it did not compose", () => {
      const reported: string[] = [];
      class Reporter extends WorkerEvaluationAbsenceReportPort {
        withoutEvaluatorExecution(): void {
          reported.push("execution");
        }

        withoutExecutionReceiptLedger(): void {
          reported.push("receipt");
        }
      }

      createWorkerEvaluationProcessing(
        processingOptions({
          absence: new Reporter(),
          execution: collaborators(new RecordingLangevals(), new RecordingCosts()),
        }),
      );

      expect(reported).toEqual(["receipt"]);
    });
  });
});
