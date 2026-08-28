import type { AgentType } from "@langwatch/agent-contract";

export type AgentEditorDrawerName = "agentCodeEditor" | "agentHttpEditor" | "agentWorkflowEditor";

export function getAgentEditorDrawer(type: AgentType): AgentEditorDrawerName {
  switch (type) {
    case "code":
      return "agentCodeEditor";
    case "http":
      return "agentHttpEditor";
    case "workflow":
      return "agentWorkflowEditor";
    case "signature":
      throw new Error(`Unhandled agent type: ${type} — signature agents have no editor drawer`);
  }
}
