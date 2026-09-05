/**
 * @vitest-environment node
 */
import type { WorkflowService } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { WorkflowEvaluationAdapter } from "../workflow-evaluation.adapter";

describe("WorkflowEvaluationAdapter.run", () => {
  describe("given the workflow fails with an error carrying a stack trace", () => {
    describe("when the failure is mapped for the caller", () => {
      /** @scenario "A workflow evaluation failure returns no server stack trace" */
      it("reports the failure with no message or stack off the caught error", async () => {
        const workflows = {
          run: () =>
            Promise.reject(
              new Error("ENOENT: no such file or directory, open '/srv/langwatch/secrets.env'"),
            ),
        } as unknown as WorkflowService;

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
