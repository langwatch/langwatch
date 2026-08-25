import { Cron } from "croner";
import { z } from "zod";

export const MIN_REPORT_INTERVAL_MS = 15 * 60 * 1000;
const GAP_PROBE_RUNS = 5;
const CRON_FIELD_COUNT = 5;

/** Stable scheduler target used for the durable report calendar row. */
export const REPORT_SCHEDULER_TARGET_TYPE = "reportTrigger" as const;

export const reportScheduleSchema = z
  .object({
    cron: z.string().min(1).max(120),
    timezone: z.string().min(1).max(64),
  })
  .superRefine(({ cron, timezone }, context) => {
    const reject = (path: "cron" | "timezone", message: string): void => {
      context.addIssue({ code: "custom", path: [path], message });
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

export const reportSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dashboard"), dashboardId: z.string().min(1) }),
  z.object({
    kind: z.literal("customGraph"),
    customGraphId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("traceQuery"),
    filters: z.record(z.string(), z.unknown()).default({}),
    metric: z.string().optional(),
    topN: z.number().int().min(1).max(100).default(5),
  }),
]);
export type ReportSource = z.infer<typeof reportSourceSchema>;
export const reportActionParamsSchema = z.object({
  source: reportSourceSchema,
  schedule: reportScheduleSchema,
  compareToPrevious: z.boolean().default(false),
});
export type ReportScheduleInput = z.infer<typeof reportScheduleSchema>;
export type ReportActionParams = z.infer<typeof reportActionParamsSchema>;

export type BuildReportTriggerDataInput = {
  id: string;
  name: string;
  projectId: string;
  action: "SEND_EMAIL" | "SEND_SLACK_MESSAGE" | "SEND_WEBHOOK";
  actionParams: ReportActionParams & Record<string, unknown>;
};
export type ReportTriggerData = {
  id: string;
  name: string;
  projectId: string;
  action: BuildReportTriggerDataInput["action"];
  triggerKind: "REPORT";
  actionParams: Record<string, unknown>;
  filters: Record<string, never>;
  active: true;
};

export function buildReportTriggerData(
  input: BuildReportTriggerDataInput,
): ReportTriggerData {
  return {
    id: input.id,
    name: input.name.trim(),
    projectId: input.projectId,
    action: input.action,
    triggerKind: "REPORT",
    actionParams: { ...input.actionParams },
    filters: {},
    active: true,
  };
}

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
