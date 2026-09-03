import { archiveRunPlan as apiArchiveRunPlan } from "../langwatch-api-run-plans.js";

/**
 * Handles the platform_archive_run_plan MCP tool invocation.
 */
export async function handleArchiveRunPlan(params: {
  id: string;
}): Promise<string> {
  const result = await apiArchiveRunPlan(params.id);

  return `Run plan ${result.id} is archived. Its past runs stay readable, and the name is free for a new plan.`;
}
