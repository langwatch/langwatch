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
    case "connected":
      // Declared by the customer's own code and registered from it, so the
      // platform shows a connected agent rather than editing it.
      throw new Error(`Unhandled agent type: ${type} — connected agents are registered from code`);
  }
}
