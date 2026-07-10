import type { AlertType, Prisma, TriggerAction } from "@prisma/client";
import { z } from "zod";

/**
 * Builder for the `Trigger` row that represents a custom-graph threshold
 * alert. Single source of truth for the `actionParams` JSON shape so the
 * legacy "Add Alert" path on the dashboard graph card (`graphs.updateById`)
 * and the new automations-drawer path (`automation.upsert` with
 * `customGraphId` set) write the exact same row format. The downstream
 * dispatcher (cron + event-sourced reactor in ADR-034 Phase 5) reads one
 * shape; if either writer drifts, alerts silently stop firing.
 *
 * `actionParams` carries the threshold rule (`threshold`, `operator`,
 * `timePeriod`, `seriesName`) alongside the destination (`members` for
 * email, `slackWebhook` for Slack). `filters` is forced to `{}` because
 * the conditions for a graph alert live on the graph itself, not on the
 * trigger row.
 */

export const GRAPH_ALERT_OPERATORS = ["gt", "lt", "gte", "lte", "eq"] as const;
export type GraphAlertOperator = (typeof GRAPH_ALERT_OPERATORS)[number];

/** Time-window values the graph-alert UI offers (minutes). Mirrors the
 *  `TIME_PERIOD_LABELS` options rendered in `FiltersSecondaryDrawer.tsx`.
 *  The dispatcher accepts any positive integer, but the UI is constrained
 *  to this set so the validator can reject typos / hostile input on the
 *  wire. */
export const GRAPH_ALERT_TIME_PERIODS = [1, 5, 15, 30, 60, 1440] as const;
export type GraphAlertTimePeriod = (typeof GRAPH_ALERT_TIME_PERIODS)[number];

export const graphAlertOperatorSchema = z.enum(GRAPH_ALERT_OPERATORS);
// Keep the literals in sync with GRAPH_ALERT_TIME_PERIODS above. Spelling
// them out (instead of casting `.map(z.literal)` to a tuple) means a
// mismatch surfaces as a type error rather than being silently swallowed by
// an `as unknown as` cast.
export const graphAlertTimePeriodSchema = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal(1440),
]);

/** Validation schema for the graph-alert portion of `actionParams`. The
 *  destination keys (`members` / `slackWebhook`) are validated by the
 *  per-action schema; this schema only covers the threshold-rule keys
 *  the graph-alert flow contributes. */
export const graphAlertActionParamsSchema = z.object({
  threshold: z.number().finite(),
  operator: graphAlertOperatorSchema,
  timePeriod: graphAlertTimePeriodSchema,
  seriesName: z.string().min(1, "Pick a series to monitor."),
});

export type GraphAlertActionParams = z.infer<
  typeof graphAlertActionParamsSchema
>;

export interface BuildGraphAlertTriggerDataInput {
  id: string;
  name: string;
  projectId: string;
  action: TriggerAction;
  alertType: AlertType;
  customGraphId: string;
  /** Threshold rule (always present) plus the destination keys for the
   *  chosen `action`. */
  actionParams: GraphAlertActionParams & {
    members?: string[];
    slackWebhook?: string;
  };
}

export interface GraphAlertTriggerData {
  id: string;
  name: string;
  projectId: string;
  action: TriggerAction;
  actionParams: Prisma.InputJsonValue;
  filters: Prisma.InputJsonValue;
  alertType: AlertType;
  active: true;
  customGraphId: string;
}

/**
 * Shape the `Trigger` row inserted/updated for a graph-threshold alert.
 * Stores the user's name as typed — the legacy dashboard path baked an
 * `Alert:` prefix into the row, which then leaked back into the edit form
 * and doubled up with the list's Type column. Legacy prefixes are stripped
 * (case-insensitive) so pre-existing rows clean up on their next save.
 */
export function buildGraphAlertTriggerData({
  id,
  name,
  projectId,
  action,
  alertType,
  customGraphId,
  actionParams,
}: BuildGraphAlertTriggerDataInput): GraphAlertTriggerData {
  const trimmed = name.replace(/^\s*alert:\s*/i, "").trim();
  return {
    id,
    name: trimmed,
    projectId,
    action,
    actionParams: { ...actionParams } as Prisma.InputJsonValue,
    filters: {} as Prisma.InputJsonValue,
    alertType,
    active: true,
    customGraphId,
  };
}

/**
 * Inverse of `buildGraphAlertTriggerData` — reads the graph-alert-shaped
 * `actionParams` off a persisted `Trigger` row. Fills the gap the SSOT
 * writer left open (builder5015-004): both writers (create + update) go
 * through the builder, both readers (dashboard edit hydration + drawer
 * hydration) should now go through this parser instead of ad-hoc casts.
 *
 * Returns `null` if the row's `actionParams` doesn't parse — callers can
 * treat that as "not a graph alert" or fall back to the legacy shape.
 * Unknown keys ARE preserved (destination keys like `members` /
 * `slackWebhook` travel through) so the caller doesn't have to re-read
 * the row for the other action-params bits.
 */
export function extractGraphAlertFromTriggerRow(
  actionParams: unknown,
): (GraphAlertActionParams & Record<string, unknown>) | null {
  if (typeof actionParams !== "object" || actionParams === null) return null;
  const parsed = graphAlertActionParamsSchema.safeParse(actionParams);
  if (!parsed.success) return null;
  // Preserve destination keys (members, slackWebhook, etc.) alongside the
  // typed threshold rule. Zod's `.safeParse` strips unknowns; we merge them
  // back so callers don't lose the send-side context.
  return {
    ...(actionParams as Record<string, unknown>),
    ...parsed.data,
  };
}
