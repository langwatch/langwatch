import { z } from "zod";

export type WorkflowRunPermission = "traces:create" | "evaluations:manage" | "workflows:manage";

/** The order a run's permissions are listed in, so one set always has one spelling. */
const RUN_PERMISSION_ORDER: readonly WorkflowRunPermission[] = [
  "traces:create",
  "evaluations:manage",
  "workflows:manage",
];

const nodeSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  data: z
    .looseObject({
      parameters: z
        .array(z.looseObject({ identifier: z.string(), value: z.unknown().optional() }))
        .optional(),
    })
    .optional(),
});

function permissionOfNode(node: z.infer<typeof nodeSchema>): WorkflowRunPermission | undefined {
  if (node.type === "evaluator") return "evaluations:manage";
  if (node.type === "custom") return "workflows:manage";
  const callsWorkflow = node.data?.parameters?.some(
    ({ identifier, value }) => identifier === "agent_type" && value === "workflow",
  );

  return node.type === "agent" && callsWorkflow ? "workflows:manage" : undefined;
}

/**
 * What the engine calls back into LangWatch for, and nothing more: traces always, evaluations when
 * a reached node is an evaluator or the run logs batch results, workflows when a reached node
 * runs another workflow. A component run reaches only its own node.
 */
export function runKeyPermissions({
  eventType,
  nodeId,
  nodes,
}: {
  eventType: string;
  nodeId?: string | undefined;
  nodes: readonly unknown[];
}): readonly WorkflowRunPermission[] {
  const needed = new Set<WorkflowRunPermission>(["traces:create"]);
  if (eventType === "execute_evaluation") needed.add("evaluations:manage");

  for (const candidate of nodes) {
    const parsed = nodeSchema.safeParse(candidate);
    if (!parsed.success) continue;
    if (eventType === "execute_component" && parsed.data.id !== nodeId) continue;
    const permission = permissionOfNode(parsed.data);
    if (permission) needed.add(permission);
  }

  return RUN_PERMISSION_ORDER.filter((permission) => needed.has(permission));
}
