/**
 * Which workflow an agent is linked to, when the row and the config disagree.
 *
 * The column was added after the config field, so both carry an answer on the
 * rows written before the migration and only one carries it after. Every read
 * that resolves an agent's fields goes through this, which is why the
 * precedence is pinned here rather than inside one caller's suite.
 */
import { describe, expect, it } from "vitest";
import { linkedWorkflowId } from "../agent";

describe("linkedWorkflowId", () => {
  describe("when the agent row carries a workflowId", () => {
    it("prefers the column over the config", () => {
      expect(
        linkedWorkflowId({
          workflowId: "wf_column",
          config: { name: "a", workflow_id: "wf_config" },
        }),
      ).toBe("wf_column");
    });
  });

  describe("when only the config carries one", () => {
    it("falls back to the config, as older agents have no column", () => {
      expect(
        linkedWorkflowId({
          workflowId: null,
          config: { name: "a", workflow_id: "wf_config" },
        }),
      ).toBe("wf_config");
    });
  });
});
