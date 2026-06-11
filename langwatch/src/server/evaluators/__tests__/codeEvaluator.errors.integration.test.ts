/**
 * @vitest-environment node
 *
 * Integration tests for runCodeEvaluator's result conversion against the
 * real engine response envelope ({ status, result, error }), with the
 * engine boundary mocked using shapes captured from a live nlpgo run.
 * See specs/evaluators/evaluator-management.feature.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "../../db";
import { runCodeEvaluator } from "../codeEvaluator";

const { nlpgoFetchMock } = vi.hoisted(() => ({ nlpgoFetchMock: vi.fn() }));

vi.mock("~/server/nlpgo/nlpgoFetch", () => ({
  nlpgoFetch: nlpgoFetchMock,
}));

vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn(async (event: unknown) => event),
}));

const projectId = "test-project-id";
const evaluatorId = "evaluator_code_errors_test";

describe("runCodeEvaluator result conversion", () => {
  beforeAll(async () => {
    await prisma.evaluator.upsert({
      where: { id: evaluatorId },
      create: {
        id: evaluatorId,
        projectId,
        name: "Conversion Test Evaluator",
        slug: "conversion-test-evaluator",
        type: "code",
        config: {
          code: "class Code:\n    def __call__(self, output: str):\n        ...\n",
          inputs: [{ identifier: "output", type: "str" }],
          outputs: [
            { identifier: "passed", type: "bool" },
            { identifier: "score", type: "float" },
          ],
        },
      },
      update: {},
    });
  });

  afterAll(async () => {
    await prisma.evaluator.delete({ where: { id: evaluatorId } });
  });

  describe("when the code raises an exception", () => {
    /** @scenario Code evaluator code errors surface per row */
    it("surfaces the exception message as the error result", async () => {
      nlpgoFetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          trace_id: "trace_x",
          status: "error",
          error: {
            node_id: "code_evaluator",
            type: "ValueError",
            message: "intentional kaboom",
            traceback: "Traceback (most recent call last): ...",
          },
        }),
      });

      const result = await runCodeEvaluator({
        projectId,
        evaluatorId,
        data: { output: "boom" },
      });

      expect(result.status).toBe("error");
      if (result.status !== "error") throw new Error("unreachable");
      expect(result.details).toBe("intentional kaboom");
      expect(result.traceback?.[0]).toContain("Traceback");
    });
  });

  describe("when the code returns its outputs", () => {
    /** @scenario Code evaluator executes through the engine code component */
    it("returns the processed result with coerced scalars", async () => {
      nlpgoFetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          trace_id: "trace_y",
          status: "success",
          result: { passed: "true", score: "0.75" },
        }),
      });

      const result = await runCodeEvaluator({
        projectId,
        evaluatorId,
        data: { output: "hello" },
      });

      expect(result).toMatchObject({
        status: "processed",
        passed: true,
        score: 0.75,
      });
    });
  });
});
