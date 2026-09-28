import { createTrigger as apiCreateTrigger } from "../langwatch-api-triggers.js";
import {
  type GraphAlertRule,
  type NotificationCadence,
  type ReportRule,
  type TriggerAction,
  type TriggerActionParams,
  type TriggerAlertType,
  type TriggerTemplates,
  validateActionParamsForAction,
} from "../schemas/triggers.js";

/**
 * Handles the platform_create_trigger MCP tool invocation. `actionParams` is
 * optional, as it was before it was stated per channel: omitted sends `{}` and
 * the server decides; stated, it is checked against the channel first.
 */
export async function handleCreateTrigger(params: {
  name: string;
  action: TriggerAction;
  actionParams?: TriggerActionParams;
  filters?: string;
  filterQuery?: string;
  customGraphId?: string;
  graphAlert?: GraphAlertRule;
  report?: ReportRule;
  templates?: TriggerTemplates;
  notificationCadence?: NotificationCadence;
  message?: string;
  alertType?: TriggerAlertType;
}): Promise<string> {
  if (params.actionParams !== undefined) {
    const verdict = validateActionParamsForAction({
      action: params.action,
      actionParams: params.actionParams,
    });
    if (!verdict.ok) return `Error: ${verdict.message}`;
  }
  let filters: Record<string, unknown> | undefined;
  if (params.filters) {
    const parsed = parseJsonObject(params.filters);
    if (!parsed) return "Error: filters must be a JSON object";
    filters = parsed;
  }
  const trigger = await apiCreateTrigger({ ...params, filters });
  return `Trigger "${trigger.name}" created (ID: ${trigger.id}, Kind: ${trigger.kind ?? "AUTOMATION"}, Action: ${trigger.action}).`;
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
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
