/**
 * Which workflow an agent is linked to when the column and the config disagree (pre-migration rows
 * carry both). Every field-resolving read goes through this, so the precedence is pinned here.
 */
import { describe, expect, it } from "vitest";

import { findLinkedWorkflowIds } from "../agent.ts";

describe("findLinkedWorkflowIds", () => {
  describe("when the agent row carries a workflowId", () => {
    it("prefers the column over the config", () => {
      expect(
        findLinkedWorkflowIds({
          workflowId: "wf_column",
          config: { name: "a", workflow_id: "wf_config" },
        }),
      ).toEqual(["wf_column"]);
    });
  });

  describe("when only the config carries one", () => {
    it("falls back to the config, as older agents have no column", () => {
      expect(
        findLinkedWorkflowIds({
          workflowId: null,
          config: { name: "a", workflow_id: "wf_config" },
        }),
      ).toEqual(["wf_config"]);
    });
  });
});
