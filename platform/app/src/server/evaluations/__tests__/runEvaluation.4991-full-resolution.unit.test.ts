/**
 * #4991 ("2 of 2" of #4888) — call-site wiring for the evaluation read paths.
 *
 * Evaluators score against trace/thread content, so the reads that feed them
 * must resolve the FULL offloaded IO value, not the 64 KB preview. Proves the
 * content-consuming reads in runEvaluation construct TraceService WITH
 * blob-resolution deps and pass full:true:
 *   - the trace-level getById (the evaluator's primary input);
 *   - the thread-level getTracesByThreadId (thread-based evaluators).
 *
 * The third site (buildDataForEvaluation's resolveThreadMappingsIntoData) uses
 * the same getTracesByThreadId(..., { full: true }) call proven here.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraceCanonicalisationService } from "@langwatch/trace-server";

const {
  mockCreate,
  mockBuildDeps,
  getByIdMock,
  getTracesByThreadIdMock,
  getEvaluationsMultipleMock,
  executeNativeEvaluationMock,
  BLOB_DEPS,
} = vi.hoisted(() => {
  const BLOB_DEPS = {
    blobStore: { tag: "blobStore" },
    ioExtractionService: { tag: "ioExtractionService" },
  };
  return {
    mockCreate: vi.fn(),
    mockBuildDeps: vi.fn(() => BLOB_DEPS),
    getByIdMock: vi.fn(),
    getTracesByThreadIdMock: vi.fn(),
    getEvaluationsMultipleMock: vi.fn(),
    executeNativeEvaluationMock: vi.fn(),
    BLOB_DEPS,
  };
});

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: { create: mockCreate },
}));

vi.mock("~/server/traces/trace-blob-resolution.deps", () => ({
  buildTraceBlobResolutionDeps: mockBuildDeps,
}));

// Force the native short-circuit so the evaluator runs in-process and we never
// make a langevals HTTP call.
vi.mock("~/runtime/app/features/evaluator-native-observability.adapter", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/runtime/app/features/evaluator-native-observability.adapter")
    >();
  return {
    ...actual,
    executeNativeEvaluation: executeNativeEvaluationMock,
    augmentEvaluationResult: ({ result }: { result: unknown }) => result,
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

import type { EvaluatorTypes } from "@langwatch/evaluator-contract";
import { runEvaluationForTrace } from "../runEvaluation";

const evaluatorType = "test/evaluator" as EvaluatorTypes;

const protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
} as const;

const traceCanonicalisation = TraceCanonicalisationService.create();

const traceMapping = {
  mapping: { input: { source: "input" } },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockReturnValue({
    getById: getByIdMock,
    getTracesByThreadId: getTracesByThreadIdMock,
    getEvaluationsMultiple: getEvaluationsMultipleMock,
  });
  mockBuildDeps.mockReturnValue(BLOB_DEPS);
  getTracesByThreadIdMock.mockResolvedValue([]);
  getEvaluationsMultipleMock.mockResolvedValue({});
  executeNativeEvaluationMock.mockResolvedValue({
    status: "processed",
    score: 1,
  });
});

function expectConstructedWithDeps() {
  expect(mockCreate).toHaveBeenCalledWith({
    blobResolutionDeps: BLOB_DEPS,
    evaluationService: expect.anything(),
    traceCanonicalisation,
  });
}

describe("runEvaluation — #4991 full blob resolution on evaluator reads", () => {
  describe("given a trace-level evaluation", () => {
    beforeEach(() => {
      getByIdMock.mockResolvedValue({
        trace_id: "trace-1",
        metadata: {},
        spans: [],
        input: { value: "hello" },
        output: { value: "world" },
      });
    });

    describe("when the trace is read for evaluation", () => {
      it("constructs with blob deps and resolves the trace IO full", async () => {
        await runEvaluationForTrace({
          projectId: "project-1",
          traceId: "trace-1",
          evaluatorType,
          settings: {},
          mappings: traceMapping,
          level: "trace",
          protections,
          evaluations: {} as never,
          traceCanonicalisation,
        });

        expectConstructedWithDeps();
        expect(getByIdMock).toHaveBeenCalledWith(
          "project-1",
          "trace-1",
          expect.anything(),
          { full: true },
        );
      });
    });
  });

  describe("given a thread-level evaluation", () => {
    beforeEach(() => {
      getByIdMock.mockResolvedValue({
        trace_id: "trace-1",
        metadata: { thread_id: "thread-1" },
        spans: [],
        input: { value: "hello" },
        output: { value: "world" },
      });
    });

    describe("when the thread traces are read for evaluation", () => {
      it("constructs with blob deps and resolves the thread IO full", async () => {
        await runEvaluationForTrace({
          projectId: "project-1",
          traceId: "trace-1",
          evaluatorType,
          settings: {},
          mappings: traceMapping,
          level: "thread",
          protections,
          evaluations: {} as never,
          traceCanonicalisation,
        });

        expectConstructedWithDeps();
        expect(getTracesByThreadIdMock).toHaveBeenCalledWith(
          "project-1",
          "thread-1",
          expect.anything(),
          { full: true },
        );
      });
    });
  });
});
