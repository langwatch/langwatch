/**
 * `optimization.chat` runs the workflow the caller named, in the scope that was
 * checked - on the same application operation the public run endpoint reaches.
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { workflowOptimizationTrpcTransport } from "../workflow-optimization.trpc.ts";

type Invoke = (args: {
  app: WorkflowApi;
  input: unknown;
  actor: { id: string };
  scope: { tier: "project"; id: string };
  signal: undefined;
}) => unknown;

/** The declaration mounted on a runtime that keeps each handler callable. */
function callersFor(app: WorkflowApi): ReadonlyMap<string, (input: unknown) => unknown> {
  const callers = new Map<string, (input: unknown) => unknown>();

  const runtime: TrpcProcedureFactory<object> = {
    procedure: (request) => {
      const invoke: Invoke = request.handle;
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

  workflowOptimizationTrpcTransport.router(runtime, () => app);

  return callers;
}

describe("optimization.chat", () => {
  describe("given a published workflow the caller may run", () => {
    it("runs the workflow the caller named, in the scope that was checked", async () => {
      const runPublished = vi.fn<WorkflowApi["runPublished"]>(async () => ({
        status: "success",
        result: {},
      }));
      const callers = callersFor(createApiFixture<WorkflowApi>({ runPublished }, "WorkflowApi"));

      await callers.get("chat")?.({
        projectId: "project_1",
        workflowId: "workflow_1",
        inputMessages: [{ input: "hello" }],
      });

      expect(runPublished).toHaveBeenCalledWith({
        workflowId: "workflow_1",
        projectId: "project_1",
        body: { input: "hello" },
      });
    });

    it("sends an empty body when the chat carried no message", async () => {
      const runPublished = vi.fn<WorkflowApi["runPublished"]>(async () => ({
        status: "success",
        result: {},
      }));
      const callers = callersFor(createApiFixture<WorkflowApi>({ runPublished }, "WorkflowApi"));

      await callers.get("chat")?.({
        projectId: "project_1",
        workflowId: "workflow_1",
        inputMessages: [],
      });

      expect(runPublished).toHaveBeenCalledWith(expect.objectContaining({ body: {} }));
    });
  });

  describe("given a workflow published as an evaluator is switched off", () => {
    it("clears the flag and archives the evaluator that wrapped it", async () => {
      const setWorkflowFlags = vi.fn<WorkflowApi["setWorkflowFlags"]>(async () => undefined);
      const unlinkEvaluatorFromWorkflow = vi.fn<WorkflowApi["unlinkEvaluatorFromWorkflow"]>(
        async () => undefined,
      );
      const callers = callersFor(
        createApiFixture<WorkflowApi>(
          { setWorkflowFlags, unlinkEvaluatorFromWorkflow },
          "WorkflowApi",
        ),
      );

      const answered = await callers.get("disableAsEvaluator")?.({
        projectId: "project_1",
        workflowId: "workflow_1",
      });

      expect(setWorkflowFlags).toHaveBeenCalledWith({
        projectId: "project_1",
        workflowId: "workflow_1",
        isEvaluator: false,
      });
      expect(unlinkEvaluatorFromWorkflow).toHaveBeenCalledWith({
        projectId: "project_1",
        workflowId: "workflow_1",
      });
      expect(answered).toEqual({ success: true });
    });
  });
});
