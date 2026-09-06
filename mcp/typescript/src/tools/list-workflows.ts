import { listWorkflows as apiListWorkflows } from "../langwatch-api-workflows.js";

export async function handleListWorkflows(): Promise<string> {
  const workflows = await apiListWorkflows();

  if (!Array.isArray(workflows) || workflows.length === 0) {
    return "No workflows found in this project.";
  }

  const lines: string[] = [];
  lines.push(`# Workflows (${workflows.length} total)\n`);

  for (const w of workflows) {
    const tags: string[] = [];
    if (w.isEvaluator) tags.push("evaluator");
    if (w.isComponent) tags.push("component");
    const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";

    lines.push(`## ${w.name}${tagStr}`);
    lines.push(`**ID**: ${w.id}`);
    if (w.description) lines.push(`**Description**: ${w.description}`);
    lines.push(`**Updated**: ${w.updatedAt}`);
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_workflow` with the ID to see full workflow details.",
  );

  return lines.join("\n");
}
