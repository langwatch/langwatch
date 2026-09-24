import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EvaluationApi, type ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type {
  EventingCommands,
  EventingCommandSender,
  QueueSendOptions,
} from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { memoryStores } from "@langwatch/process-stores";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { EvaluationCommandDispatcherService } from "../../services/evaluation-command-dispatcher.service.ts";
import type { EvaluationProcessingPipeline } from "../../services/evaluation-processing.service.ts";
import { EVALUATION_TEST_CONFIG, installableEvaluation } from "./evaluation.fixture.ts";

async function installed() {
  return createApp({ role: "api" })
    .withModules([installableEvaluation])
    .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
    .withStores(memoryStores())
    .provide({
      workflow: createApiFixture<WorkflowApi>(),
      trace: createApiFixture<TraceApi>(),
      "model-provider": createApiFixture<ModelProviderApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      evaluator: createApiFixture<EvaluatorApi>(),
      monitor: createApiFixture<MonitorApi>(),
      automation: createApiFixture<AutomationApi>(),
      analytics: createApiFixture<AnalyticsApi>(),
      "data-retention": createApiFixture<DataRetentionApi>(),
    })
    .boot();
}

const TRACE_EVALUATION: ExecuteEvaluationCommandData = {
  tenantId: "project-1",
  traceId: "trace-1",
  evaluationId: "evaluation-1",
  evaluatorId: "monitor-1",
  evaluatorType: "langevals/exact_match",
  occurredAt: 1,
};

function connected() {
  const sent: { payload: ExecuteEvaluationCommandData; options: unknown }[] = [];
  const commands = EvaluationCommandDispatcherService.create();
  commands.connect(
    createApiFixture<EventingCommands<EvaluationProcessingPipeline>>({
      executeEvaluation: createApiFixture<EventingCommandSender<ExecuteEvaluationCommandData>>({
        send: async (payload, options) => {
          sent.push({ payload, options });
        },
      }),
    }),
  );
  const optionsOf = (index: number): QueueSendOptions<ExecuteEvaluationCommandData> => {
    const entry = sent[index];
    if (!entry?.options) throw new Error(`send ${index} carried no options`);
    return entry.options;
  };
  return { commands, sent, optionsOf };
}

describe("given the evaluation_processing command dispatcher is connected", () => {
  describe("when trace queues an evaluation for a trace-level monitor", () => {
    /** @scenario "A trace's online evaluation is queued with the trace trigger's dedup" */
    it("keeps the command's delay and dedups per trace and evaluator for six minutes", async () => {
      const { commands, sent, optionsOf } = connected();

      await commands.queueTraceEvaluation(TRACE_EVALUATION);

      const options = optionsOf(0);
      expect(sent[0]?.payload).toEqual(TRACE_EVALUATION);
      expect(options.delay).toBeUndefined();
      expect(options.deduplication?.ttlMs).toBe(360_000);
      expect(options.deduplication?.shouldSurviveDispatch).toBe(true);
      expect(options.deduplication?.makeId(TRACE_EVALUATION)).toBe(
        "exec:project-1:trace-1:monitor-1",
      );
    });
  });

  describe("when trace queues an evaluation for a thread-level monitor on a threaded trace", () => {
    /** @scenario "A thread-level online evaluation waits out the thread's idle window" */
    it("delays and dedups per thread for the idle window", async () => {
      const { commands, optionsOf } = connected();
      const threaded = { ...TRACE_EVALUATION, threadIdleTimeout: 120, threadId: "thread-1" };

      await commands.queueTraceEvaluation(threaded);

      const options = optionsOf(0);
      expect(options.delay).toBe(120_000);
      expect(options.deduplication?.ttlMs).toBe(120_000);
      expect(options.deduplication?.makeId(threaded)).toBe(
        "exec:project-1:thread:thread-1:monitor-1",
      );
    });
  });
});

describe("given an installed evaluation module whose senders are not connected", () => {
  describe("when trace queues an evaluation", () => {
    /** @scenario "A trace evaluation queued before the pipeline is connected is refused by name" */
    it("refuses naming the missing executeEvaluation sender", async () => {
      const runtime = await installed();

      try {
        await expect(
          runtime.service(EvaluationApi).queueTraceEvaluation(TRACE_EVALUATION),
        ).rejects.toThrow(/executeEvaluation sender/);
      } finally {
        await runtime.stop();
      }
    });
  });
});
