/**
 * @vitest-environment node
 */

import type { WorkflowService } from "@langwatch/workflow-process";
import { describe, expect, it, vi } from "vitest";

import { WorkflowEvaluationAdapter } from "../workflow-evaluation.service.ts";

/** The full class has many members; every test here only calls `run`. */
function stubWorkflows(run: WorkflowService["run"]): WorkflowService {
  return { run } as unknown as WorkflowService;
}

describe("WorkflowEvaluationAdapter.run", () => {
  describe("given the target trace has no usable parent link", () => {
    describe("when the evaluator workflow is dispatched to nlpgo", () => {
      /** @scenario "An evaluator workflow emits no spans when the target trace has no parent link" */
      it("asks nlpgo not to emit spans", async () => {
        const run = vi
          .fn()
          .mockResolvedValue({ result: { status: "processed" }, status: "success" });
        const workflows = stubWorkflows(run);

        await WorkflowEvaluationAdapter.create(workflows).run({
          workflowId: "workflow-1",
          projectId: "project-1",
          inputs: {},
        });

        expect(run).toHaveBeenCalledWith(expect.objectContaining({ doNotTrace: true }));
      });
    });

    describe("when a parent link is present", () => {
      it("does not ask nlpgo to suppress spans", async () => {
        const run = vi
          .fn()
          .mockResolvedValue({ result: { status: "processed" }, status: "success" });
        const workflows = stubWorkflows(run);

        await WorkflowEvaluationAdapter.create(workflows).run({
          workflowId: "workflow-1",
          projectId: "project-1",
          inputs: {},
          parentTrace: {
            traceId: "0af7651916cd43dd8448eb211c80319c",
            parentSpanId: "b7ad6b7169203331",
          },
        });

        expect(run).toHaveBeenCalledWith(expect.objectContaining({ doNotTrace: false }));
      });
    });
  });

  describe("given the workflow fails with an error carrying a stack trace", () => {
    describe("when the failure is mapped for the caller", () => {
      /** @scenario "A workflow evaluation failure returns no server stack trace" */
      it("reports the failure with no message or stack off the caught error", async () => {
        const workflows = stubWorkflows(() =>
          Promise.reject(
            new Error("ENOENT: no such file or directory, open '/srv/langwatch/secrets.env'"),
          ),
        );

        const outcome = await WorkflowEvaluationAdapter.create(workflows).run({
          workflowId: "workflow-1",
          projectId: "project-1",
          inputs: {},
        });

        const serialised = JSON.stringify(outcome);
        expect(serialised).not.toContain("/srv/langwatch");
        expect(serialised).not.toContain("workflow-evaluation.adapter");
        expect(outcome.status).toBe("error");
        expect(outcome.result).toMatchObject({
          status: "error",
          details: "Workflow execution failed",
          error_type: "WORKFLOW_ERROR",
          traceback: [],
        });
      });
    });
  });
});
