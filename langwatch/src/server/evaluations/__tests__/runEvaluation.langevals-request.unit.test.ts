import { beforeEach, describe, expect, it, vi } from "vitest";

// runEvaluation forwards mapped data to langevals. Two behaviours here are
// regression-prone and are pinned by this file:
//
// 1. The evaluator-extras allowlist: fields beyond the canonical 6 pass
//    through ONLY when the evaluator declares them (required/optional
//    fields). Pairwise's candidate_a_id/candidate_a_output depend on this;
//    the block was dropped once during the ES-removal PR and restored in
//    fced13719. Undeclared keys must stay filtered or strict pydantic
//    models on the langevals side 422.
//
// 2. The 5xx retry recursion must retry exactly once and preserve
//    data/settings AND the trace (redaction context) — the legacy worker
//    dropped `trace` on retry, so a guardrail retried after a transient
//    500 lost `droppedCategories` and could report clean.

const { stagedLangevalsFetchMock, augmentEvaluationResultMock } = vi.hoisted(
  () => ({
    stagedLangevalsFetchMock: vi.fn(),
    augmentEvaluationResultMock: vi.fn(),
  }),
);

vi.mock("~/server/langevals/stagedFetch", () => ({
  stagedLangevalsFetch: stagedLangevalsFetchMock,
}));

vi.mock("~/server/evaluations/native/registry", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/evaluations/native/registry")
    >();
  return {
    ...actual,
    augmentEvaluationResult: augmentEvaluationResultMock,
  };
});

vi.mock("~/server/evaluations/evaluators", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/evaluations/evaluators")>();
  return {
    ...actual,
    AVAILABLE_EVALUATORS: {
      "test/pairwise": {
        name: "Test Pairwise Evaluator",
        requiredFields: ["input", "output"],
        optionalFields: ["candidate_a_id", "candidate_a_output"],
        envVars: [],
      },
    },
  };
});

import type { EvaluatorTypes } from "~/server/evaluations/evaluators";
import type { Trace } from "@langwatch/contracts/tracer";
import { runEvaluation } from "../runEvaluation";

// Registered above in the mocked AVAILABLE_EVALUATORS; cast past the real
// EvaluatorTypes union which doesn't know about the test fixture.
const evaluatorType = "test/pairwise" as EvaluatorTypes;

const okResponse = () => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => [{ status: "processed", score: 1 }],
});

const serverErrorResponse = () => ({
  ok: false,
  status: 500,
  statusText: "Internal Server Error",
  json: async () => ({ detail: "boom" }),
});

describe("runEvaluation langevals request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    augmentEvaluationResultMock.mockImplementation(
      ({ result }: { result: unknown }) => result,
    );
  });

  describe("given an evaluator that declares extra fields beyond the canonical 6", () => {
    it("passes declared extras through and filters undeclared mapping keys", async () => {
      stagedLangevalsFetchMock.mockResolvedValueOnce(okResponse());

      await runEvaluation({
        projectId: "project-1",
        evaluatorType,
        data: {
          type: "default",
          data: {
            input: "which candidate is better?",
            output: "candidate B response",
            candidate_a_id: "variant-a",
            candidate_a_output: "candidate A response",
            sneaky_undeclared_key: "must not ride through",
          },
        },
        settings: {},
      });

      expect(stagedLangevalsFetchMock).toHaveBeenCalledTimes(1);
      const requestBody = stagedLangevalsFetchMock.mock.calls[0]?.[0]?.body as {
        data: Record<string, unknown>[];
      };
      const entry = requestBody.data[0]!;

      // Declared extras ride through untouched...
      expect(entry.candidate_a_id).toBe("variant-a");
      expect(entry.candidate_a_output).toBe("candidate A response");
      // ...the canonical fields are normalized as usual...
      expect(entry.input).toBe("which candidate is better?");
      expect(entry.output).toBe("candidate B response");
      // ...and undeclared keys are filtered out (strict pydantic 422 guard).
      expect(entry).not.toHaveProperty("sneaky_undeclared_key");
    });
  });

  describe("given langevals responds 500 then 200", () => {
    it("retries exactly once, preserving data, settings, and the trace's redaction context", async () => {
      stagedLangevalsFetchMock
        .mockResolvedValueOnce(serverErrorResponse())
        .mockResolvedValueOnce(okResponse());

      const trace = {
        trace_id: "trace-1",
        spans: [],
        privacy: { droppedCategories: ["pii"] },
      } as unknown as Trace;
      const settings = { some_setting: "value" };

      await runEvaluation({
        projectId: "project-1",
        evaluatorType,
        data: { type: "default", data: { input: "hello", output: "world" } },
        settings,
        trace,
      });

      // One initial attempt + exactly one retry.
      expect(stagedLangevalsFetchMock).toHaveBeenCalledTimes(2);

      const firstCall = stagedLangevalsFetchMock.mock.calls[0]?.[0];
      const secondCall = stagedLangevalsFetchMock.mock.calls[1]?.[0];
      expect(secondCall.body.data).toEqual(firstCall.body.data);
      expect(secondCall.body.settings).toEqual(settings);

      // The retried attempt must still see the trace's droppedCategories —
      // the augmenter uses them to flag ingestion-redacted content.
      expect(augmentEvaluationResultMock).toHaveBeenCalledWith(
        expect.objectContaining({ droppedCategories: ["pii"] }),
      );
    });

    it("throws a real Error (not a string) when retries are exhausted", async () => {
      stagedLangevalsFetchMock
        .mockResolvedValueOnce(serverErrorResponse())
        .mockResolvedValueOnce(serverErrorResponse());

      await expect(
        runEvaluation({
          projectId: "project-1",
          evaluatorType,
          data: { type: "default", data: { input: "hello", output: "world" } },
          settings: {},
        }),
      ).rejects.toThrowError(/^500 /);

      expect(stagedLangevalsFetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
