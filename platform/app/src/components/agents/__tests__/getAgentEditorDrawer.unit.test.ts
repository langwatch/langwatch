import { describe, expect, it } from "vitest";

import { getAgentEditorDrawer } from "../getAgentEditorDrawer";

describe("getAgentEditorDrawer", () => {
  describe("given a code agent", () => {
    describe("when its editor drawer is looked up", () => {
      /** @scenario Agents page routes each agent type to its matching editor drawer */
      it("returns agentCodeEditor", () => {
        expect(getAgentEditorDrawer("code")).toBe("agentCodeEditor");
      });
    });
  });

  describe("given an http agent", () => {
    describe("when its editor drawer is looked up", () => {
      it("returns agentHttpEditor", () => {
        expect(getAgentEditorDrawer("http")).toBe("agentHttpEditor");
      });
    });
  });

  describe("given a workflow agent", () => {
    describe("when its editor drawer is looked up", () => {
      it("returns agentWorkflowEditor (not workflowSelector, which is create-only)", () => {
        expect(getAgentEditorDrawer("workflow")).toBe("agentWorkflowEditor");
      });
    });
  });

  describe("given a connected agent", () => {
    describe("when its editor drawer is looked up", () => {
      it("returns agentConnectedDetail", () => {
        expect(getAgentEditorDrawer("connected")).toBe("agentConnectedDetail");
      });
    });
  });

  describe("given a signature agent", () => {
    describe("when its editor drawer is looked up", () => {
      it("throws because signature agents have no editor drawer", () => {
        expect(() => getAgentEditorDrawer("signature")).toThrow(
          /signature agents have no editor drawer/,
        );
      });
    });
  });
});
