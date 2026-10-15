import { NOTIFICATION_CADENCES, triggerSchema, type Trigger } from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:automation:trigger-mapper");

const parseCadence = (value: unknown): string =>
  typeof value === "string" && (NOTIFICATION_CADENCES as readonly string[]).includes(value)
    ? value
    : "immediate";

/**
 * An earlier release wrote `filters` and `actionParams` as JSON-encoded strings
 * inside the jsonb column. Unwrap those; anything that is not a plain object
 * after unwrapping reads as `{}` (with a warning) rather than failing the row.
 */
export function normaliseJsonObject(
  value: unknown,
  context: { column: string; triggerId?: unknown },
): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = undefined;
    }
  }
  if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
  }
  logger.warn(
    { column: context.column, triggerId: context.triggerId, receivedType: typeof value },
    "trigger column is not a JSON object, reading it as an empty object",
  );
  return {};
}

export function mapTriggerRow(row: unknown): Trigger {
  const value = row as Record<string, unknown>;
  return triggerSchema.parse({
    ...value,
    actionParams: normaliseJsonObject(value.actionParams, {
      column: "actionParams",
      triggerId: value.id,
    }),
    filters: normaliseJsonObject(value.filters, { column: "filters", triggerId: value.id }),
    filterQuery: value.filterQuery ?? null,
    pausedReason: value.pausedReason ?? null,
    pausedAt: value.pausedAt ?? null,
    message: value.message ?? null,
    alertType: value.alertType ?? null,
    customGraphId: value.customGraphId ?? null,
    notificationCadence: parseCadence(value.notificationCadence),
    lastRunAt:
      typeof value.lastRunAt === "number" ? new Date(value.lastRunAt) : (value.lastRunAt ?? null),
    templates: {
      slackTemplateType: value.slackTemplateType ?? null,
      slackTemplate: value.slackTemplate ?? null,
      emailSubjectTemplate: value.emailSubjectTemplate ?? null,
      emailBodyTemplate: value.emailBodyTemplate ?? null,
    },
  });
}
