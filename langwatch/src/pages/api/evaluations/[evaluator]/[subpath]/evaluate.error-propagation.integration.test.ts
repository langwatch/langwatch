/**
 * @regression https://github.com/langwatch/langwatch/issues/986
 *
 * Vertex AI (and other provider) errors were not surfaced in the evaluations API.
 * When runEvaluation threw a string (not an Error object), the catch block replaced
 * the actual error message with "Internal error" because it only checked `instanceof Error`.
 *
 * This test verifies that the error details are propagated correctly regardless of
 * whether the thrown value is an Error object or a string.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock runEvaluation to control what it throws
const mockRunEvaluation = vi.fn();
vi.mock(
  "../../../../../server/background/workers/evaluationsWorker",
  () => ({
    runEvaluation: (...args: unknown[]) => mockRunEvaluation(...args),
  }),
);

// Mock prisma to avoid database dependency
const testProject = {
  id: "test-project-error-propagation",
  apiKey: "test-api-key-error-propagation",
  featureEventSourcingEvaluationIngestion: false,
  disableElasticSearchEvaluationWriting: true,
};

vi.mock("../../../../../server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn().mockResolvedValue(testProject),
    },
    monitor: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    evaluator: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    workflow: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    cost: {
      create: vi.fn().mockResolvedValue({ id: "cost_test" }),
    },
  },
}));

// Mock posthog error capture to avoid side effects
vi.mock("../../../../../utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

// Must import handler AFTER vi.mock so the mock takes effect
const { handleEvaluatorCall } = await import("./evaluate");

describe("Feature: Evaluation error propagation (#986)", () => {
  beforeEach(() => {
    mockRunEvaluation.mockReset();
  });

  const callHandler = async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      headers: {
        "X-Auth-Token": testProject.apiKey,
      },
      body: {
        data: {
          output: "test output",
          expected_output: "test expected",
        },
      },
      query: {
        evaluator: "langevals",
        subpath: "exact_match",
      },
    });

    await handleEvaluatorCall(req, res, false);
    return { req, res };
  };

  describe("when runEvaluation throws an Error object", () => {
    it("propagates the Error message to response details", async () => {
      const errorMessage = "Provider vertex_ai is not configured";
      mockRunEvaluation.mockRejectedValue(new Error(errorMessage));

      const { res } = await callHandler();

      const data = (res as any)._getJSONData();
      expect(res.statusCode).toBe(200);
      expect(data).toMatchObject({
        status: "error",
        details: errorMessage,
      });
    });
  });

  describe("when runEvaluation throws a string", () => {
    it("propagates the string error to response details", async () => {
      const errorMessage = "422 Unprocessable Entity: model not found";
      mockRunEvaluation.mockRejectedValue(errorMessage);

      const { res } = await callHandler();

      const data = (res as any)._getJSONData();
      expect(res.statusCode).toBe(200);
      expect(data).toMatchObject({
        status: "error",
        details: errorMessage,
      });
    });
  });

  describe("when runEvaluation throws a falsy value", () => {
    it("falls back to 'Internal error' for unknown error types", async () => {
      mockRunEvaluation.mockRejectedValue(null);

      const { res } = await callHandler();

      const data = (res as any)._getJSONData();
      expect(res.statusCode).toBe(200);
      expect(data).toMatchObject({
        status: "error",
        details: "Internal error",
      });
    });
  });
});
