import type { AgentType } from "~/components/agents/AgentTypeSelectorDrawer";

type AgentEditorDrawerName =
  | "agentCodeEditor"
  | "agentHttpEditor"
  | "agentWorkflowEditor";

export function getAgentEditorDrawer(
  type: AgentType,
): AgentEditorDrawerName {
  switch (type) {
    case "code":
      return "agentCodeEditor";
    case "http":
      return "agentHttpEditor";
    case "workflow":
      return "agentWorkflowEditor";
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unhandled agent type: ${_exhaustive as string}`);
    }
  }
}
