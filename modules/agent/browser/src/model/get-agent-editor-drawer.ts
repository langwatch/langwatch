import type { AgentType } from "@langwatch/agent-contract";

import type { AgentEditorDrawer } from "./agent-management-host.ts";

/** Every name here is declared in `agent.web.ts`: drawer names are the wire. */
export function getAgentEditorDrawer(type: AgentType): AgentEditorDrawer {
  switch (type) {
    case "code":
      return "agentCodeEditor";
    case "http":
      return "agentHttpEditor";
    case "workflow":
      return "agentWorkflowEditor";
    case "voice":
      // No `agentVoiceEditor` drawer is declared, so no name would answer.
      throw new Error(`Unhandled agent type: ${type} — voice agents have no editor drawer yet`);
    case "signature":
      throw new Error(`Unhandled agent type: ${type} — signature agents have no editor drawer`);
    case "connected":
      // Declared by the customer's own code and registered from it, so the
      // platform shows a connected agent rather than editing it.
      throw new Error(`Unhandled agent type: ${type} — connected agents are registered from code`);
  }
}
