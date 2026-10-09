/**
 * runCodeEvaluator must not ask the engine to emit spans when it has no
 * parent link to hand it. Without a `traceparent` the engine cannot join
 * the caller's trace and mints a fresh trace id instead, so the evaluator's
 * spans become a separate evaluation-origin trace that then flows back
 * through the trace pipeline as if it were customer traffic.
 * See specs/monitors/online-evaluator-loop-prevention.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { nlpgoFetchMock, findFirstMock } = vi.hoisted(() => ({
  nlpgoFetchMock: vi.fn(),
  findFirstMock: vi.fn(),
}));

vi.mock("~/server/nlpgo/nlpgoFetch", () => ({
  nlpgoFetch: nlpgoFetchMock,
}));

vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn(async (event: unknown) => event),
}));

vi.mock("../../db", () => ({
  prisma: {
    evaluator: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
  },
}));

import { runCodeEvaluator } from "../runCodeEvaluator";

const projectId = "project_test";
const evaluatorId = "evaluator_test";

function sentPayload(): { do_not_trace?: boolean; trace_id?: string } {
  const call = nlpgoFetchMock.mock.calls[0]?.[0] as {
    body: { payload: { do_not_trace?: boolean; trace_id?: string } };
  };
  return call.body.payload;
}

describe("runCodeEvaluator()", () => {
  beforeEach(() => {
    nlpgoFetchMock.mockReset();
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue({
      id: evaluatorId,
      projectId,
      type: "code",
      config: {
        code: "class Code:\n    def __call__(self, output: str):\n        ...\n",
        inputs: [{ identifier: "output", type: "str" }],
        outputs: [{ identifier: "passed", type: "bool" }],
      },
    });
    nlpgoFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", result: { passed: true } }),
    });
  });

  describe("when no parent link could be built for the target trace", () => {
    /** @scenario A code evaluator emits no spans when the target trace has no parent link */
    it("asks the engine not to emit spans", async () => {
      await runCodeEvaluator({
        projectId,
        evaluatorId,
        data: { output: "x" },
        traceId: "trace_legacyShapedId",
        parentCausalityDepth: 0,
        parentTrace: undefined,
      });

      expect(sentPayload().do_not_trace).toBe(true);
    });
  });

  describe("when a parent link exists", () => {
    it("lets the engine emit spans under that parent", async () => {
      await runCodeEvaluator({
        projectId,
        evaluatorId,
        data: { output: "x" },
        traceId: "0af7651916cd43dd8448eb211c80319c",
        parentCausalityDepth: 0,
        parentTrace: {
          traceId: "0af7651916cd43dd8448eb211c80319c",
          parentSpanId: "b7ad6b7169203331",
        },
      });

      expect(sentPayload().do_not_trace).toBe(false);
    });
  });
});
