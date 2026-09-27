/** The kinds of stored agent the new-agent flow offers. */
export type NewAgentType = "code" | "workflow" | "http";

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
