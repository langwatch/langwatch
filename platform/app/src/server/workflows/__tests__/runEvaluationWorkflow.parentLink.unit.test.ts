/**
 * runEvaluationWorkflow must not ask the engine to emit spans when it has
 * no parent link to hand it. Without a `traceparent` the engine cannot join
 * the caller's trace and mints a fresh trace id instead, so the evaluator's
 * spans become a separate evaluation-origin trace that then flows back
 * through the trace pipeline as if it were customer traffic.
 * See specs/monitors/online-evaluator-loop-prevention.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { nlpgoFetchMock, workflowFindUniqueMock, versionFindUniqueMock } =
  vi.hoisted(() => ({
    nlpgoFetchMock: vi.fn(),
    workflowFindUniqueMock: vi.fn(),
    versionFindUniqueMock: vi.fn(),
  }));

vi.mock("../../nlpgo/nlpgoFetch", () => ({
  nlpgoFetch: nlpgoFetchMock,
}));

vi.mock("../../../optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn(async (event: unknown) => event),
}));

vi.mock("../../api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi.fn(async () => ({})),
}));

vi.mock("../stripUnsupportedLLMParams", () => ({
  stripUnsupportedLLMParamsFromWorkflow: vi.fn(async () => undefined),
}));

vi.mock("../../db", () => ({
  prisma: {
    workflow: {
      findUnique: (...args: unknown[]) => workflowFindUniqueMock(...args),
    },
    workflowVersion: {
      findUnique: (...args: unknown[]) => versionFindUniqueMock(...args),
    },
  },
}));

import { LATEST_SPEC_VERSION } from "../../../optimization_studio/types/dsl";
import { runEvaluationWorkflow } from "../runWorkflow";

const projectId = "project_test";
const workflowId = "workflow_test";

function sentPayload(): { do_not_trace?: boolean; trace_id?: string } {
  const call = nlpgoFetchMock.mock.calls[0]?.[0] as {
    body: { payload: { do_not_trace?: boolean; trace_id?: string } };
  };
  return call.body.payload;
}

describe("runEvaluationWorkflow()", () => {
  beforeEach(() => {
    nlpgoFetchMock.mockReset();
    workflowFindUniqueMock.mockReset();
    versionFindUniqueMock.mockReset();
    workflowFindUniqueMock.mockResolvedValue({
      id: workflowId,
      projectId,
      publishedId: "version_test",
    });
    versionFindUniqueMock.mockResolvedValue({
      id: "version_test",
      projectId,
      dsl: {
        workflow_id: workflowId,
        spec_version: LATEST_SPEC_VERSION,
        name: "Eval",
        icon: "",
        description: "",
        version: "1",
        nodes: [],
        edges: [],
        state: {},
      },
    });
    nlpgoFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", result: { passed: true } }),
    });
  });

  describe("when no parent link could be built for the target trace", () => {
    /** @scenario An evaluator workflow emits no spans when the target trace has no parent link */
    it("asks the engine not to emit spans", async () => {
      await runEvaluationWorkflow(
        workflowId,
        projectId,
        { trace_id: "trace_legacyShapedId" },
        undefined,
        0,
        undefined,
      );

      expect(sentPayload().do_not_trace).toBe(true);
    });
  });

  describe("when a parent link exists", () => {
    it("lets the engine emit spans under that parent", async () => {
      await runEvaluationWorkflow(
        workflowId,
        projectId,
        { trace_id: "0af7651916cd43dd8448eb211c80319c" },
        undefined,
        0,
        {
          traceId: "0af7651916cd43dd8448eb211c80319c",
          parentSpanId: "b7ad6b7169203331",
        },
      );

      expect(sentPayload().do_not_trace).toBe(false);
    });
  });
});
