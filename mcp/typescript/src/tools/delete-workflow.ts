import { deleteWorkflow as apiDeleteWorkflow } from "../langwatch-api-workflows.js";

export async function handleDeleteWorkflow(params: { id: string }): Promise<string> {
  const result = await apiDeleteWorkflow(params.id);

  return `Workflow archived successfully!\n\n**ID**: ${result.id}`;
}
