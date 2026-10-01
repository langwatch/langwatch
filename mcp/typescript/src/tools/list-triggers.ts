import { listTriggers as apiListTriggers } from "../langwatch-api-triggers.ts";
import type { Trigger } from "../schemas/triggers.ts";

/**
 * Handles the platform_list_triggers MCP tool invocation.
 */
export async function handleListTriggers(params: {
  format?: "digest" | "json";
}): Promise<string> {
  const triggers = await apiListTriggers();
  if (params.format === "json") return JSON.stringify(triggers, null, 2);
  if (triggers.length === 0) {
    return "No triggers found. Use `platform_create_trigger` to create one.";
  }
  const lines = [`# Triggers (${triggers.length} total)\n`];
  for (const trigger of triggers) lines.push(...digestTrigger(trigger), "");
  return lines.join("\n");
}

function digestTrigger(trigger: Trigger): string[] {
  const lines = [
    `## ${trigger.name}`,
    `**ID**: ${trigger.id}`,
    `**Kind**: ${trigger.kind ?? "AUTOMATION"}`,
    `**Action**: ${trigger.action}`,
    `**Status**: ${trigger.active ? "active" : "inactive"}`,
  ];
  if (trigger.alertType) lines.push(`**Alert**: ${trigger.alertType}`);
  if (trigger.filterQuery) lines.push(`**Filter query**: ${trigger.filterQuery}`);
  else if (Object.keys(trigger.filters).length > 0) {
    lines.push(`**Filters**: ${JSON.stringify(trigger.filters)}`);
  }
  if (trigger.graphAlert) {
    const rule = trigger.graphAlert;
    lines.push(
      `**Fires when**: ${rule.seriesName} ${rule.operator} ${rule.threshold} over ${rule.timePeriod}m${trigger.customGraphId ? ` on graph ${trigger.customGraphId}` : ""}`,
    );
  }
  if (trigger.report) lines.push(`**Report**: ${JSON.stringify(trigger.report)}`);
  return lines;
}
