/**
 * One-line renderings of what an automation fires by, shared by `trigger get`
 * and `trigger list`. The API answers with `graphAlert` for an alert and
 * `report` for a scheduled report; both are null for anything else.
 */

type Loose = Record<string, unknown> | null | undefined;

/** An automation as `/api/triggers` answers with it, credentials redacted. */
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
  const operator = String(graphAlert.operator ?? "");
  const symbol = OPERATOR_SYMBOLS[operator] ?? operator;
  const graph = customGraphId ? ` on graph ${customGraphId}` : "";
  return `${String(graphAlert.seriesName ?? "series")} ${symbol} ${String(graphAlert.threshold ?? "?")} over ${String(graphAlert.timePeriod ?? "?")}m${graph}`;
}

export function summariseReport({ report }: { report: Loose }): string | undefined {
  if (!report) return undefined;
  const source = isRecord(report.source) ? report.source : {};
  const schedule = isRecord(report.schedule) ? report.schedule : {};
  const target =
    source.kind === "dashboard"
      ? `dashboard ${String(source.dashboardId ?? "?")}`
      : source.kind === "customGraph"
        ? `graph ${String(source.customGraphId ?? "?")}`
        : source.kind === "traceQuery"
          ? "trace table"
          : String(source.kind ?? "report");
  const compare = report.compareToPrevious ? ", vs previous" : "";
  return `${target} at "${String(schedule.cron ?? "?")}" ${String(schedule.timezone ?? "")}${compare}`.trimEnd();
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
