import { describe, expect, it } from "vitest";

import { getAgentEditorDrawer } from "../getAgentEditorDrawer";

describe("getAgentEditorDrawer", () => {
  describe("when editing a code agent", () => {
    it("returns agentCodeEditor", () => {
      expect(getAgentEditorDrawer("code")).toBe("agentCodeEditor");
    });
  });

  describe("when editing an http agent", () => {
    it("returns agentHttpEditor", () => {
      expect(getAgentEditorDrawer("http")).toBe("agentHttpEditor");
    });
  });

  describe("when editing a workflow agent", () => {
    it("returns agentWorkflowEditor (not workflowSelector, which is create-only)", () => {
      expect(getAgentEditorDrawer("workflow")).toBe("agentWorkflowEditor");
    });
  });
});
