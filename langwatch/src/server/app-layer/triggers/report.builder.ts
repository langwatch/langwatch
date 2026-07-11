import type { Prisma, TriggerAction } from "@prisma/client";
import { TriggerKind } from "@prisma/client";
import { Cron } from "croner";
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

/** IANA timezone name. The refinement below proves `Intl` knows it. */
const timezoneSchema = z.string().min(1).max(64);

/** A cron expression. The refinement below proves `croner` can run it. */
const cronSchema = z.string().min(1).max(120);

/**
 * The floor on how often a report may send. A report emails/posts a rendered
 * document to an arbitrary recipient list, so an unbounded cadence is both a
 * product mistake and an abuse vector — `* * * * *` would mail every minute
 * (and croner's optional seconds field would let `* * * * * *` mail every
 * second). Exported so the authoring UI can enforce the same bound.
 */
export const MIN_REPORT_INTERVAL_MS = 15 * 60 * 1000;

/** Runs we look ahead over when measuring a schedule's tightest gap. */
const GAP_PROBE_RUNS = 5;

/** Standard cron: minute, hour, day-of-month, month, day-of-week. */
const CRON_FIELD_COUNT = 5;

/**
 * A report's schedule, validated the way the scheduler will actually run it.
 * The old schema took any non-empty string, so a malformed cron or an unknown
 * timezone only blew up later — inside `computeNextRunAt`, AFTER the active
 * `Trigger` row was committed — leaving a report that shows as live but has no
 * calendar entry and can never fire. Everything the scheduler needs is proven
 * here, at the trust boundary, before anything is written.
 */
export const reportScheduleSchema = z
  .object({
    cron: cronSchema,
    timezone: timezoneSchema,
  })
  .superRefine(({ cron, timezone }, ctx) => {
    const reject = (path: "cron" | "timezone", message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      reject(
        "timezone",
        `"${timezone}" is not a known timezone. Pick an IANA zone such as "Europe/Amsterdam" or "UTC".`,
      );
      return;
    }

    // croner also accepts 6- and 7-field patterns, where the leading field is
    // SECONDS. A report has no business firing on a second granularity, and the
    // authoring UI never emits one, so the seconds form is rejected outright
    // rather than left to the interval floor below to catch by accident.
    if (cron.trim().split(/\s+/).length !== CRON_FIELD_COUNT) {
      reject(
        "cron",
        `A report schedule is a 5-field cron expression (minute hour day-of-month month day-of-week), for example "0 9 * * 1".`,
      );
      return;
    }

    let runs: Date[];
    try {
      runs = new Cron(cron, { timezone }).nextRuns(GAP_PROBE_RUNS, new Date());
    } catch {
      reject("cron", `"${cron}" is not a valid cron expression.`);
      return;
    }

    // A pattern can parse and still never come due (e.g. "0 9 30 2 *" — there
    // is no February 30th). The scheduler cannot register a job with no next
    // run, so that report would silently never send.
    if (runs.length < 2) {
      reject(
        "cron",
        `"${cron}" does not run on a repeating schedule. Pick a schedule that comes due more than once.`,
      );
      return;
    }

    const tightestGapMs = Math.min(
      ...runs.slice(1).map((run, index) => run.getTime() - runs[index]!.getTime()),
    );
    if (tightestGapMs < MIN_REPORT_INTERVAL_MS) {
      reject(
        "cron",
        `A report can send at most every ${MIN_REPORT_INTERVAL_MS / 60_000} minutes. This schedule sends more often than that.`,
      );
    }
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
