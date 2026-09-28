/** The kinds of stored agent the new-agent flow offers. */
export type NewAgentType = UiNewAgentType;

/** Where choosing a kind leads (main's #3193); each name is declared in `agent.web.ts`. */
export function newAgentDrawerFor(
  type: NewAgentType,
): "agentCodeEditor" | "agentHttpEditor" | "workflowSelector" {
  switch (type) {
    case "code":
      return "agentCodeEditor";
    case "http":
      return "agentHttpEditor";
    case "workflow":
      return "workflowSelector";
  }
}

import type { UiNewAgentType } from "@langwatch/browser-host/drawer";
