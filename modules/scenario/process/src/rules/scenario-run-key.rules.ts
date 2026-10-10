import { runKeyPermissions } from "@langwatch/workflow-contract";

/**
 * What a scenario run's child calls LangWatch for, and nothing more: its own run events and the
 * agent relay (scenarios:create), traces written and read back for the judge, and whatever the
 * graph needs when the target is a workflow.
 */
export function scenarioRunKeyPermissions({
  targetType,
  workflowNodes,
}: {
  targetType: string;
  workflowNodes: unknown;
}): readonly string[] {
  const child = ["traces:create", "traces:view", "scenarios:create"];
  if (targetType !== "workflow") return child;

  const graph = runKeyPermissions({
    eventType: "execute_flow",
    nodes: Array.isArray(workflowNodes) ? workflowNodes : [],
  });
  return [...new Set([...child, ...graph])];
}
