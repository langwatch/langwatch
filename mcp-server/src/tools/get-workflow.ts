import { getWorkflow as apiGetWorkflow } from "../langwatch-api-workflows.js";

export async function handleGetWorkflow(params: { id: string }): Promise<string> {
  const workflow = await apiGetWorkflow(params.id);

  const lines: string[] = [];
  lines.push(`# ${workflow.name}\n`);
  lines.push(`**ID**: ${workflow.id}`);
  if (workflow.description) lines.push(`**Description**: ${workflow.description}`);
  if (workflow.icon) lines.push(`**Icon**: ${workflow.icon}`);
  lines.push(`**Evaluator**: ${workflow.isEvaluator ? "yes" : "no"}`);
  lines.push(`**Component**: ${workflow.isComponent ? "yes" : "no"}`);
  lines.push(`**Created**: ${workflow.createdAt}`);
  lines.push(`**Updated**: ${workflow.updatedAt}`);

  return lines.join("\n");
}
