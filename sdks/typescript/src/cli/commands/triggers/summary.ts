/**
 * One-line renderings of what an automation fires by, shared by `trigger get`
 * and `trigger list`. The API answers with `graphAlert` for an alert and
 * `report` for a scheduled report; both are null for anything else.
 */

type Loose = Record<string, unknown> | null | undefined;

/** An automation as `/api/v1/triggers` answers with it, credentials redacted. */
export interface TriggerRecord {
  id: string;
  name: string;
  action: string;
  actionParams: Record<string, unknown>;
  filters: Record<string, unknown>;
  filterQuery?: string | null;
  kind?: string;
  customGraphId?: string | null;
  graphAlert?: Loose;
  report?: Loose;
  active: boolean;
  message: string | null;
  alertType: string | null;
  createdAt: string;
  updatedAt: string;
  platformUrl?: string;
}

const OPERATOR_SYMBOLS: Record<string, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "=",
};

export function summariseGraphAlert({
  graphAlert,
  customGraphId,
}: {
  graphAlert: Loose;
  customGraphId?: string | null;
}): string | undefined {
  if (!graphAlert) return undefined;
  const operator = text({ value: graphAlert.operator, fallback: "" });
  const symbol = OPERATOR_SYMBOLS[operator] ?? operator;
  const graph = customGraphId ? ` on graph ${customGraphId}` : "";
  return `${text({ value: graphAlert.seriesName, fallback: "series" })} ${symbol} ${text({ value: graphAlert.threshold, fallback: "?" })} over ${text({ value: graphAlert.timePeriod, fallback: "?" })}m${graph}`;
}

export function summariseReport({ report }: { report: Loose }): string | undefined {
  if (!report) return undefined;
  const source = isRecord(report.source) ? report.source : {};
  const schedule = isRecord(report.schedule) ? report.schedule : {};
  const target =
    source.kind === "dashboard"
      ? `dashboard ${text({ value: source.dashboardId, fallback: "?" })}`
      : source.kind === "customGraph"
        ? `graph ${text({ value: source.customGraphId, fallback: "?" })}`
        : source.kind === "traceQuery"
          ? "trace table"
          : text({ value: source.kind, fallback: "report" });
  const compare = report.compareToPrevious ? ", vs previous" : "";
  return `${target} at "${text({ value: schedule.cron, fallback: "?" })}" ${text({ value: schedule.timezone, fallback: "" })}${compare}`.trimEnd();
}

/** The Slack connection (and channel) an automation posts through, if any. */
export function summariseSlackConnection({
  actionParams,
}: {
  actionParams: Loose;
}): string | undefined {
  if (!actionParams || typeof actionParams.slackIntegrationId !== "string") {
    return undefined;
  }
  const channel =
    typeof actionParams.slackChannelId === "string"
      ? ` in ${actionParams.slackChannelId}`
      : "";
  return `${actionParams.slackIntegrationId}${channel}`;
}

/** The rule column for a listing: the alert or report summary, or `-`. */
export function summariseRule(trigger: {
  graphAlert?: Loose;
  report?: Loose;
  customGraphId?: string | null;
}): string {
  return (
    summariseGraphAlert({
      graphAlert: trigger.graphAlert,
      customGraphId: trigger.customGraphId,
    }) ??
    summariseReport({ report: trigger.report }) ??
    "-"
  );
}

/** A scalar field as text; objects and absent values read as the fallback. */
function text({ value, fallback }: { value: unknown; fallback: string }): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
