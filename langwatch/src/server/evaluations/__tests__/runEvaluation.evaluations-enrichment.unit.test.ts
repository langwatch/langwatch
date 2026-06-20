import { beforeEach, describe, expect, it, vi } from "vitest";

// runEvaluationForTrace fetches the trace via TraceService.getById, which
// (unlike the legacy worker's getTraceById({ includeEvaluations: true })) does
// NOT enrich evaluations. An evaluator whose field maps from the `evaluations`
// source then reads `trace.evaluations ?? []` and silently gets nothing. The
// fix re-fetches evaluations via getEvaluationsMultiple and attaches them
// before mapping. This test locks that behaviour.

const {
  getByIdMock,
  getEvaluationsMultipleMock,
  getTracesByThreadIdMock,
  executeNativeEvaluationMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  getEvaluationsMultipleMock: vi.fn(),
  getTracesByThreadIdMock: vi.fn(),
  executeNativeEvaluationMock: vi.fn(),
}));

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: {
    create: () => ({
      getById: getByIdMock,
      getEvaluationsMultiple: getEvaluationsMultipleMock,
      getTracesByThreadId: getTracesByThreadIdMock,
    }),
  },
}));

// Force the native short-circuit so the evaluator runs in-process and we can
// capture the mapped data it receives without a langevals HTTP call.
vi.mock("~/server/evaluations/evaluators.native", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/evaluations/evaluators.native")
    >();
  return { ...actual, isNativeEvaluatorType: () => true };
});

vi.mock("~/server/evaluations/native/registry", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/evaluations/native/registry")
    >();
  return {
    ...actual,
    executeNativeEvaluation: executeNativeEvaluationMock,
    augmentEvaluationResult: ({ result }: { result: unknown }) => result,
  };
});

vi.mock("~/server/evaluations/evaluators", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/evaluations/evaluators")>();
  return {
    ...actual,
    AVAILABLE_EVALUATORS: {
      "test/evaluator": {
        name: "Test Evaluator",
        requiredFields: ["input"],
        optionalFields: [],
      },
    },
  };
});

import type { EvaluatorTypes } from "~/server/evaluations/evaluators";
import { runEvaluationForTrace } from "../runEvaluation";

// Registered above in the mocked AVAILABLE_EVALUATORS; cast past the real
// EvaluatorTypes union which doesn't know about the test fixture.
const evaluatorType = "test/evaluator" as EvaluatorTypes;

const protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
} as const;

describe("runEvaluationForTrace evaluations enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getByIdMock.mockResolvedValue({
      trace_id: "trace-1",
      metadata: {},
      spans: [],
      input: { value: "hello" },
      output: { value: "world" },
      // getById does not populate evaluations — the regression scenario.
      evaluations: undefined,
    });
    getTracesByThreadIdMock.mockResolvedValue([]);
    executeNativeEvaluationMock.mockResolvedValue({
      status: "processed",
      score: 1,
    });
  });

  describe("given an evaluator whose field maps from the `evaluations` source", () => {
    it("fetches the trace's evaluations and feeds them to the mapping (not silently empty)", async () => {
      getEvaluationsMultipleMock.mockResolvedValue({
        "trace-1": [
          {
            evaluator_id: "prior-eval",
            name: "Prior",
            status: "processed",
            score: 0.9,
            passed: true,
          },
        ],
      });

      await runEvaluationForTrace({
        projectId: "project-1",
        traceId: "trace-1",
        evaluatorType,
        settings: {},
        mappings: {
          mapping: {
            input: {
              source: "evaluations",
              key: "prior-eval",
              subkey: "score",
            },
          },
        } as never,
        protections,
      });

      // The enrichment must have queried the trace's evaluations...
      expect(getEvaluationsMultipleMock).toHaveBeenCalledWith(
        "project-1",
        ["trace-1"],
        expect.anything(),
      );

      // ...and the prior evaluation's score must reach the evaluator's mapped
      // input rather than being dropped to empty.
      const mappedData = executeNativeEvaluationMock.mock.calls[0]?.[0]?.data as
        | Record<string, unknown>
        | undefined;
      expect(mappedData?.input).toBe(0.9);
    });
  });

  describe("given the enrichment query returns no evaluations", () => {
    it("falls back to an empty list without throwing", async () => {
      getEvaluationsMultipleMock.mockResolvedValue({});

      await expect(
        runEvaluationForTrace({
          projectId: "project-1",
          traceId: "trace-1",
          evaluatorType,
          settings: {},
          mappings: {
            mapping: {
              input: {
                source: "evaluations",
                key: "prior-eval",
                subkey: "score",
              },
            },
          } as never,
          protections,
        }),
      ).resolves.toBeDefined();
    });
  });
});
