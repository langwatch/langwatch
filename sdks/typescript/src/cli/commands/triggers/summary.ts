/**
 * One-line renderings of what an automation fires by, shared by `trigger get`
 * and `trigger list`. The API answers with `graphAlert` for an alert and
 * `report` for a scheduled report; both are null for anything else.
 */

type Loose = Record<string, unknown> | null | undefined;

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

export interface FirePage<T> {
  fires: T[];
  nextCursor: string | null;
}

/** Reads a fires page: the paginated `{ fires, nextCursor }` body, or the bare
 *  array an older deployment answers with (which has no next page). */
export function readFirePage<T>(body: unknown): FirePage<T> {
  if (Array.isArray(body)) return { fires: body, nextCursor: null };
  if (isRecord(body)) {
    const list = Array.isArray(body.fires)
      ? body.fires
      : Array.isArray(body.data)
        ? body.data
        : [];
    const nextCursor =
      typeof body.nextCursor === "string" ? body.nextCursor : null;
    return { fires: list, nextCursor };
  }
  return { fires: [], nextCursor: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
