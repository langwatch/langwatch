/**
 * @vitest-environment node
 *
 * Integration test for the native API-keys-and-secrets evaluator running
 * through the real EvaluationExecutionService dispatch funnel. The only stubbed
 * boundary is the langevals client, so the test proves the native evaluator
 * runs in-process (the client is never called) and that ingestion redaction is
 * seen through (a [SECRET] marker still fails the evaluation).
 */
import { describe, expect, it, vi } from "vitest";
import type { LangEvalsClient } from "../../clients/langevals/langevals.client";
import {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
  type ModelEnvResolver,
  type WorkflowExecutor,
} from "../evaluation-execution.service";
import type { TraceService } from "~/server/traces/trace.service";
import type { Trace } from "~/server/tracer/types";

const SECRETS_EVALUATOR = "langwatch/api_keys_and_secrets_detection";

function makeService(trace: Trace) {
  const traceService = {
    getTracesWithSpans: vi.fn().mockResolvedValue([trace]),
    getTracesWithSpansByThreadIds: vi.fn().mockResolvedValue([]),
  } as unknown as TraceService;
  const modelEnvResolver: ModelEnvResolver = {
    resolveForEvaluator: vi.fn().mockResolvedValue({}),
  };
  const workflowExecutor: WorkflowExecutor = {
    runEvaluationWorkflow: vi.fn(),
  };
  const langevalsClient: LangEvalsClient = {
    evaluate: vi.fn(),
  };
  const deps: EvaluationExecutionDeps = {
    traceService,
    modelEnvResolver,
    workflowExecutor,
    langevalsClient,
  };
  return { service: new EvaluationExecutionService(deps), langevalsClient };
}

function buildTrace(overrides: Partial<Trace>): Trace {
  return {
    trace_id: "trace-1",
    project_id: "proj-1",
    input: { value: "hello" },
    output: { value: "world" },
    timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    spans: [],
    ...overrides,
  } as Trace;
}

const params = {
  projectId: "proj-1",
  traceId: "trace-1",
  evaluatorType: SECRETS_EVALUATOR,
  settings: null as Record<string, unknown> | null,
  mappings: null,
};

describe("native secrets evaluator through the dispatch funnel", () => {
  describe("given a trace whose input carries a live provider key", () => {
    /** @scenario The secrets evaluator runs in-process as a guardrail */
    it("fails the evaluation in-process without calling the analysis service", async () => {
      const trace = buildTrace({
        input: { value: `key sk-proj-${"A".repeat(40)} here` },
        output: { value: "ok" },
      });
      const { service, langevalsClient } = makeService(trace);

      const result = await service.executeForTrace(params);

      expect(result.status).toBe("processed");
      if (result.status === "processed") {
        expect(result.passed).toBe(false);
        expect(result.score).toBeGreaterThanOrEqual(1);
      }
      expect(langevalsClient.evaluate).not.toHaveBeenCalled();
    });
  });

  describe("given a trace whose secret was already redacted at ingestion", () => {
    it("still fails because the [SECRET] marker is read back", async () => {
      const trace = buildTrace({
        input: { value: "authorization: [SECRET]" },
        output: { value: "ok" },
      });
      const { service, langevalsClient } = makeService(trace);

      const result = await service.executeForTrace(params);

      expect(result.status).toBe("processed");
      if (result.status === "processed") {
        expect(result.passed).toBe(false);
      }
      expect(langevalsClient.evaluate).not.toHaveBeenCalled();
    });
  });
});
