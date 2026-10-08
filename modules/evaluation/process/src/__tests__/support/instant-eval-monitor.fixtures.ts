/**
 * A monitor whose judge is on Instant Evals, run through the real command, receipt and
 * execution services. Only the judge leaf's Api and the trace read are doubles.
 */
import type { EvaluationProcessingEvent } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  type InstantEvalJudgeApi,
  type InstantEvalJudgeCall,
} from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Trace } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { vi } from "vitest";

import { EvaluationExecutionIntentService } from "../../features/execution/services/evaluation-execution-intent.service.ts";
import { EvaluationExecutionReceiptService } from "../../features/execution/services/evaluation-execution-receipt.service.ts";
import { EvaluationExecutionService } from "../../features/execution/services/evaluation-execution.service.ts";
import {
  buildExecutionDeps,
  buildMonitor,
  TestCostRecorder,
} from "./evaluation-execution.fixtures.ts";

export const INSTANT_EVAL_MONITOR_PROJECT_ID = "project-evaluation-test";

type Judge = InstantEvalJudgeApi["judge"];

function traceOf(projectId: string): Trace {
  return {
    trace_id: "trace-evaluation-test",
    project_id: projectId,
    input: { value: "where is my order?" },
    output: { value: "it ships tomorrow" },
    timestamps: { started_at: 0, inserted_at: 0 },
    spans: [],
  } as unknown as Trace;
}

/** The monitor's command handler, the judge calls it made, and the cost rows it wrote. */
export function buildInstantEvalMonitor({ judge }: { judge: Judge }) {
  const calls: InstantEvalJudgeCall[] = [];
  const execution = EvaluationExecutionService.create({
    traces: {
      readTracesWithSpans: vi.fn(async () => [traceOf(INSTANT_EVAL_MONITOR_PROJECT_ID)]),
      readThreadsTraces: vi.fn(async () => []),
      readEvaluations: vi.fn(async () => ({})),
    },
    spanDigest: { format: vi.fn(async () => ""), formatThread: vi.fn(async () => "") },
    modelEnvResolver: {
      resolveForEvaluator: () => {
        throw new Error("a judge on Instant Evals looks up no model provider");
      },
    },
    langevalsClient: {
      evaluate: () => {
        throw new Error("a judge on Instant Evals never reaches the evaluator service");
      },
    },
    workflows: createApiFixture<WorkflowApi>({}),
    evaluators: createApiFixture<EvaluatorApi>({ augmentResult: ({ result }) => result }),
    workflowExecutor: {
      run: () => {
        throw new Error("a judge never runs an evaluation workflow");
      },
    },
    judges: {
      judge: async (input) => {
        calls.push(input);
        return judge(input);
      },
    },
    installEnvironment: {},
  });
  const costRecorder = new TestCostRecorder();
  const deps = buildExecutionDeps({
    monitor: buildMonitor({
      checkType: "langevals/llm_boolean",
      parameters: { model: INSTANT_EVAL_JUDGE_MODEL_ID, prompt: "is the reply polite?" },
    }),
  });
  const handler = EvaluationExecutionIntentService.create({
    ...deps,
    executionReceipt: EvaluationExecutionReceiptService.create({
      execution,
      costs: costRecorder,
    }),
  });

  return { handler, calls, costRecorder };
}

/** The one reported event a handled command appends. */
export function reportedOf(events: EvaluationProcessingEvent[]) {
  const event = events.find((candidate) => candidate.type === "lw.evaluation.reported");
  if (!event || event.type !== "lw.evaluation.reported") {
    throw new Error("expected a reported evaluation event");
  }
  return event.data;
}
