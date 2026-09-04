import type { AgentType } from "~/server/agents/agent.repository";

type AgentEditorDrawerName =
  | "agentCodeEditor"
  | "agentConnectedDetail"
  | "agentHttpEditor"
  | "agentWorkflowEditor";

export function getAgentEditorDrawer(type: AgentType): AgentEditorDrawerName {
  switch (type) {
    case "code":
      return "agentCodeEditor";
    case "http":
      return "agentHttpEditor";
    case "workflow":
      return "agentWorkflowEditor";
    case "signature":
      throw new Error(
        `Unhandled agent type: ${type} — signature agents have no editor drawer`,
      );
    case "connected":
      // Registered from code, so the drawer reads it and edits the
      // description alone.
      return "agentConnectedDetail";
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unhandled agent type: ${_exhaustive as string}`);
    }
  }
}
