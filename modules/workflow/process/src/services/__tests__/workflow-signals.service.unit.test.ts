/**
 * A created workflow reaches billing's nurturing; a failed announcement only logs.
 * @see modules/workflow/specs/workflow-service.feature
 */
import type { WorkflowCreatedSignal } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it, vi } from "vitest";

import { WorkflowSignalsService } from "../workflow-signals.service.ts";

const created: WorkflowCreatedSignal = {
  userId: "user_1",
  projectId: "project_1",
  workflowId: "workflow_1",
  workflowCount: 2,
};

describe("WorkflowSignalsService", () => {
  describe("when a workflow is created", () => {
    /** @scenario A created workflow is announced to billing for nurturing */
    it("announces the workflow and the project's count to billing", () => {
      const announce = vi.fn((_input: WorkflowCreatedSignal) => Promise.resolve());
      const signals = WorkflowSignalsService.create({ announce });

      signals.workflowCreated(created);

      expect(announce).toHaveBeenCalledWith(created);
    });
  });

  describe("when billing refuses the announcement", () => {
    /** @scenario A failed announcement never fails the workflow create */
    it("reports the failure against the project instead of raising it", async () => {
      const signals = WorkflowSignalsService.create({
        announce: () => Promise.reject(new Error("billing unreachable")),
      });
      const failed = vi.spyOn(signals, "failed").mockImplementation(() => void 0);

      expect(() => signals.workflowCreated(created)).not.toThrow();
      await vi.waitFor(() =>
        expect(failed).toHaveBeenCalledWith(expect.any(Error), { projectId: "project_1" }),
      );
    });
  });
});
