import {
  createTrigger as apiCreateTrigger,
  type CreateTriggerInput,
} from "../langwatch-api-triggers.ts";
import { validateActionParamsForAction } from "../schemas/triggers.ts";

/** An MCP tool result; `isError` tells the client the call was refused. */
export type TriggerToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** A refusal the client must read as a failed call, not a success. */
export function toolError(message: string): TriggerToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * Handles the platform_create_trigger MCP tool invocation. `actionParams` is
 * optional, as it was before it was stated per channel: omitted sends `{}` and
 * the server decides; stated, it is checked against the channel first.
 */
export async function handleCreateTrigger(
  params: Omit<CreateTriggerInput, "filters"> & { filters?: string },
): Promise<TriggerToolResult> {
  if (params.actionParams !== undefined) {
    const verdict = validateActionParamsForAction({
      action: params.action,
      actionParams: params.actionParams,
    });
    if (!verdict.ok) return toolError(verdict.message);
  }
  let filters: Record<string, unknown> | undefined;
  if (params.filters) {
    const parsed = parseJsonObject(params.filters);
    if (!parsed) return toolError("filters must be a JSON object");
    filters = parsed;
  }
  const trigger = await apiCreateTrigger({ ...params, filters });
  const text = `Trigger "${trigger.name}" created (ID: ${trigger.id}, Kind: ${trigger.kind ?? "AUTOMATION"}, Action: ${trigger.action}).`;
  return { content: [{ type: "text", text }] };
}

/** A flag value that must be a JSON object; undefined for anything else. */
export function parseJsonObject(
  raw: string,
): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return undefined;
  }
}
