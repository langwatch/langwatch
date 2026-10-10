/**
 * `evaluators.disableAsEvaluator` and `evaluators.toggleSaveAsEvaluator`: the studio's
 * evaluator switch, moved from `optimization.*` with its input and answer (round 26, CD-2).
 * Spec: modules/evaluator/specs/evaluator-service.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { WorkflowNotFoundError } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { evaluatorTrpcTransport, type EvaluatorBrowserApi } from "../evaluator.trpc.ts";

type Invoke = (args: {
  app: EvaluatorBrowserApi;
  input: unknown;
  actor: { id: string };
  scope: { tier: "project"; id: string };
  signal: undefined;
}) => unknown;

/** The declaration mounted on a runtime that keeps each handler callable. */
function callersFor(app: EvaluatorBrowserApi): ReadonlyMap<string, (input: unknown) => unknown> {
  const callers = new Map<string, (input: unknown) => unknown>();

  const runtime: TrpcProcedureFactory<object> = {
    procedure: (request) => {
      const invoke: Invoke = (args) => Reflect.apply(request.handle, undefined, [args]);
      const name = request.procedure.split(".")[1] ?? request.procedure;

      callers.set(name, (input) =>
        invoke({
          app,
          input,
          actor: { id: "user_1" },
          scope: { tier: "project", id: "project_1" },
          signal: undefined,
        }),
      );

      return {};
    },
    router: (record) => record,
  };

  evaluatorTrpcTransport.router(runtime, () => app);

  return callers;
}

function browserApi(overrides: Partial<EvaluatorBrowserApi>): EvaluatorBrowserApi {
  return {
    evaluators: () => createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
    toggleSaveAsEvaluator: vi.fn(async () => undefined),
    disableAsEvaluator: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("evaluators.disableAsEvaluator", () => {
  /** @scenario "Switching a workflow off as an evaluator archives the evaluator that wrapped it" */
  it("switches the workflow off and answers success", async () => {
    const disableAsEvaluator = vi.fn<EvaluatorBrowserApi["disableAsEvaluator"]>(
      async () => undefined,
    );
    const callers = callersFor(browserApi({ disableAsEvaluator }));

    const answered = await callers.get("disableAsEvaluator")?.({
      projectId: "project_1",
      workflowId: "workflow_1",
    });

    expect(disableAsEvaluator).toHaveBeenCalledWith({
      projectId: "project_1",
      workflowId: "workflow_1",
    });
    expect(answered).toEqual({ success: true });
  });
});

describe("evaluators.toggleSaveAsEvaluator", () => {
  /** @scenario "An archived workflow keeps its evaluator publication behaviour" */
  it("forwards the complete switch and answers success", async () => {
    const toggleSaveAsEvaluator = vi.fn<EvaluatorBrowserApi["toggleSaveAsEvaluator"]>(
      async () => undefined,
    );
    const callers = callersFor(browserApi({ toggleSaveAsEvaluator }));

    const answered = await callers.get("toggleSaveAsEvaluator")?.({
      projectId: "project_1",
      workflowId: "workflow_archived",
      isEvaluator: true,
      isComponent: false,
    });

    expect(toggleSaveAsEvaluator).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        workflowId: "workflow_archived",
        isEvaluator: true,
      }),
    );
    expect(answered).toEqual({ success: true });
  });

  /** @scenario "Saving a missing workflow as an evaluator refuses before publication changes" */
  it("propagates workflow_not_found from the switch", async () => {
    const toggleSaveAsEvaluator = vi
      .fn<EvaluatorBrowserApi["toggleSaveAsEvaluator"]>()
      .mockRejectedValue(new WorkflowNotFoundError("workflow_missing", "project_1"));
    const callers = callersFor(browserApi({ toggleSaveAsEvaluator }));

    await expect(
      callers.get("toggleSaveAsEvaluator")?.({
        projectId: "project_1",
        workflowId: "workflow_missing",
        isEvaluator: true,
        isComponent: false,
      }),
    ).rejects.toMatchObject({ code: "workflow_not_found", httpStatus: 404 });
  });
});
