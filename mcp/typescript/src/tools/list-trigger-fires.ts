import { listTriggerFires as apiListTriggerFires } from "../langwatch-api-triggers.ts";

/**
 * Handles the platform_list_trigger_fires MCP tool invocation: one page of
 * fires, newest first, and the cursor for the next page when there is one.
 */
export async function handleListTriggerFires(params: {
  id: string;
  limit?: number;
  cursor?: string;
}): Promise<string> {
  const page = await apiListTriggerFires(params);
  if (page.fires.length === 0) {
    return params.cursor ? "No more fires." : "This automation has not fired yet.";
  }
  return JSON.stringify(page, null, 2);
}
