import { describe, expect, it } from "vitest";
import { getAgentEditorDrawer } from "../get-agent-editor-drawer";

describe("getAgentEditorDrawer", () => {
  it("routes editable agent types and rejects legacy signature agents", () => {
    expect(getAgentEditorDrawer("code")).toBe("agentCodeEditor");
    expect(getAgentEditorDrawer("http")).toBe("agentHttpEditor");
    expect(getAgentEditorDrawer("workflow")).toBe("agentWorkflowEditor");
    expect(() => getAgentEditorDrawer("signature")).toThrow(
      "signature agents have no editor drawer",
    );
    expect(() => getAgentEditorDrawer("connected")).toThrow(
      "connected agents are registered from code",
    );
  });
});
