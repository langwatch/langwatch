import type { Prisma, TriggerAction } from "@prisma/client";
import { TriggerKind } from "@prisma/client";
import { z } from "zod";

/**
 * Builder for the `Trigger` row representing a scheduled REPORT (ADR-042). A
 * report is the schedule-triggered automation kind: on a calendar schedule it
 * renders a content SOURCE into the notify channels. The source is orthogonal
 * to the schedule — a report can render a whole dashboard, a single custom
 * graph, or a trace query (e.g. "top 5 errors this week" as a table).
 *
 * Single source of truth for the report `actionParams` JSON shape so the
 * upsert path and the scheduler's report handler read one format. `filters` is
 * forced to `{}` — a report's data scope lives in its `reportSource`, not on
 * the trigger's trace filters.
 */

/** IANA timezone, loosely validated (Intl does the real check at render). */
const timezoneSchema = z.string().min(1).max(64);

/** A cron expression. Kept as a string; `croner` validates it at schedule time. */
const cronSchema = z.string().min(1).max(120);

export const reportScheduleSchema = z.object({
  cron: cronSchema,
  timezone: timezoneSchema,
});
export type ReportSchedule = z.infer<typeof reportScheduleSchema>;

/**
 * The content a report renders, discriminated by `kind`. Orthogonal to the
 * schedule:
 *  - `dashboard`   — every graph on a saved dashboard, as charts.
 *  - `customGraph` — one custom graph, as a chart (the degenerate 1-graph case).
 *  - `traceQuery`  — a filtered trace query rendered as a table (e.g. top-N
 *                    errors), the trace-source report.
 */
export const reportSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dashboard"),
    dashboardId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("customGraph"),
    customGraphId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("traceQuery"),
    /** Trace filters (same shape trace automations use). */
    filters: z.record(z.string(), z.unknown()).default({}),
    /** Optional metric to rank by, e.g. an error count. */
    metric: z.string().optional(),
    /** Rows in the rendered table. */
    topN: z.number().int().min(1).max(100).default(5),
  }),
]);
export type ReportSource = z.infer<typeof reportSourceSchema>;

/**
 * The report-specific slice of `actionParams`. The destination keys
 * (`members` / `slackWebhook`) are validated by the per-action schema; this
 * covers the report contribution: what to render (`source`) and when
 * (`schedule`), plus whether to include a this-vs-last comparison.
 */
export const reportActionParamsSchema = z.object({
  source: reportSourceSchema,
  schedule: reportScheduleSchema,
  /** Include a "this period vs last" comparison in the render. */
  compareToPrevious: z.boolean().default(false),
});
export type ReportActionParams = z.infer<typeof reportActionParamsSchema>;

export interface BuildReportTriggerDataInput {
  id: string;
  name: string;
  projectId: string;
  action: TriggerAction;
  /** Report threshold-rule-equivalent (source + schedule) plus destination. */
  actionParams: ReportActionParams & {
    members?: string[];
    slackWebhook?: string;
  };
}

export interface ReportTriggerData {
  id: string;
  name: string;
  projectId: string;
  action: TriggerAction;
  triggerKind: TriggerKind;
  actionParams: Prisma.InputJsonValue;
  filters: Prisma.InputJsonValue;
  active: true;
}

/** Shape the `Trigger` row for a scheduled report. */
export function buildReportTriggerData({
  id,
  name,
  projectId,
  action,
  actionParams,
}: BuildReportTriggerDataInput): ReportTriggerData {
  return {
    id,
    name: name.trim(),
    projectId,
    action,
    triggerKind: TriggerKind.REPORT,
    actionParams: { ...actionParams } as Prisma.InputJsonValue,
    filters: {} as Prisma.InputJsonValue,
    active: true,
  };
}

/**
 * Inverse: read the report-shaped `actionParams` off a persisted row. Returns
 * `null` if it does not parse (not a report / legacy shape). Destination keys
 * are preserved alongside the typed source+schedule.
 */
export function extractReportFromTriggerRow(
  actionParams: unknown,
): (ReportActionParams & Record<string, unknown>) | null {
  if (typeof actionParams !== "object" || actionParams === null) return null;
  const parsed = reportActionParamsSchema.safeParse(actionParams);
  if (!parsed.success) return null;
  return {
    ...(actionParams as Record<string, unknown>),
    ...parsed.data,
  };
}

/** The scheduler `targetType` reports register under. */
export const REPORT_SCHEDULER_TARGET_TYPE = "reportTrigger";
