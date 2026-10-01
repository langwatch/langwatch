import { runKeyPermissions } from "@langwatch/workflow-contract";

/**
 * What a scenario run's child calls LangWatch for, and nothing more: traces always, the agent
 * relay for a connected agent, and whatever the graph needs when the target is a workflow.
 */
export function scenarioRunKeyPermissions({
  targetType,
  workflowNodes,
}: {
  targetType: string;
  workflowNodes: unknown;
}): readonly string[] {
  if (targetType === "connected") return ["traces:create", "scenarios:create"];
  if (targetType !== "workflow") return ["traces:create"];

  return runKeyPermissions({
    eventType: "execute_flow",
    nodes: Array.isArray(workflowNodes) ? workflowNodes : [],
  });
}
