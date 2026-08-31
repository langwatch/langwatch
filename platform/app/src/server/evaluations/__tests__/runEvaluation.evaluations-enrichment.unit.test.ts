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
vi.mock("~/runtime/app/features/evaluator-native-observability.adapter", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/runtime/app/features/evaluator-native-observability.adapter")
    >();
  return {
    ...actual,
    executeNativeEvaluation: executeNativeEvaluationMock,
  };
});

vi.mock("@langwatch/evaluator-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/evaluator-contract")>();
  return {
    ...actual,
    isNativeEvaluatorType: () => true,
    AVAILABLE_EVALUATORS: {
      "test/evaluator": {
        name: "Test Evaluator",
        requiredFields: ["input"],
        optionalFields: [],
      },
    },
  };
});

import type { EvaluatorService, EvaluatorTypes } from "@langwatch/evaluator-contract";
import { runEvaluationForTrace } from "../runEvaluation";

// `runEvaluation` reaches the result augmenter as `evaluators.augmentResult`.
// It is the evaluator feature's own rule and has its own tests; here it stays
// a pass-through so the read under test is what the assertions see.
const evaluators = {
  augmentResult: ({ result }: { result: unknown }) => result,
} as unknown as EvaluatorService;

/** The services this path never reaches, named so each call is complete. */
const unusedServices = {
  modelProviders: {} as never,
  managedProviders: {} as never,
  workflows: {} as never,
};

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
        evaluations: {} as never,
        traceCanonicalisation: {} as never,
        evaluators,
        ...unusedServices,
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
    it("degrades the mapped value to the empty-string fallback without throwing", async () => {
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
          evaluations: {} as never,
          traceCanonicalisation: {} as never,
          evaluators,
          ...unusedServices,
        }),
      ).resolves.toBeDefined();

      // The missing evaluation must degrade to buildDataForEvaluation's
      // empty-string fallback for default-type evaluators — not to garbage
      // mapped into the evaluator input.
      const mappedData = executeNativeEvaluationMock.mock.calls[0]?.[0]?.data as
        | Record<string, unknown>
        | undefined;
      expect(mappedData?.input).toBe("");
    });
  });
});
