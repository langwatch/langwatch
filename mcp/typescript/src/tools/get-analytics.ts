import type { AnalyticsBucket } from "../langwatch-api.js";
import { getAnalyticsTimeseries as apiGetAnalytics } from "../langwatch-api.js";
import { parseRelativeDate } from "../utils/date-parsing.js";

type GroupedData = Record<string, Record<string, number>>;

function getGroupedData(bucket: AnalyticsBucket, groupBy: string): GroupedData | undefined {
  const data = bucket[groupBy];
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return data as GroupedData;
  }
  return undefined;
}

function periodTable({
  currentPeriod,
  groupBy,
}: {
  currentPeriod: AnalyticsBucket[];
  groupBy: string | undefined;
}): string[] {
  if (currentPeriod.length === 0) return ["No data available for this period."];
  if (groupBy && currentPeriod.some((b) => getGroupedData(b, groupBy) !== undefined)) {
    const lines = ["| Date | Group | Value |", "|------|-------|-------|"];
    for (const bucket of currentPeriod) {
      const groups = getGroupedData(bucket, groupBy);
      if (!groups) continue;
      for (const [groupKey, metrics] of Object.entries(groups)) {
        const value = Object.values(metrics).find((v) => typeof v === "number") ?? "N/A";
        lines.push(`| ${bucket.date} | ${groupKey} | ${value} |`);
      }
    }
    return lines;
  }
  const lines = ["| Date | Value |", "|------|-------|"];
  for (const bucket of currentPeriod) {
    const value =
      Object.entries(bucket).find(([k]) => k !== "date" && typeof bucket[k] === "number")?.[1] ??
      "N/A";
    lines.push(`| ${bucket.date} | ${value} |`);
  }
  return lines;
}

/**
 * Handles the get_analytics MCP tool: queries analytics timeseries and
 * formats them as an AI-readable markdown table.
 */
export async function handleGetAnalytics(params: {
  metric: string;
  aggregation?: string;
  startDate?: string;
  endDate?: string;
  timeZone?: string;
  groupBy?: string;
  filters?: Record<string, string[]>;
}): Promise<string> {
  const now = Date.now();
  const startDate = params.startDate ? parseRelativeDate(params.startDate) : now - 7 * 86400000;
  const endDate = params.endDate ? parseRelativeDate(params.endDate) : now;

  // Parse metric format "category.name"
  const [category, name] = params.metric.includes(".")
    ? params.metric.split(".", 2)
    : ["metadata", params.metric];
  const metricKey = `${category}.${name}`;
  const aggregation = params.aggregation ?? "avg";

  const result = await apiGetAnalytics({
    series: [{ metric: metricKey, aggregation }],
    startDate,
    endDate,
    timeZone: params.timeZone ?? "UTC",
    groupBy: params.groupBy,
    filters: params.filters,
  });

  const lines: string[] = [];
  lines.push(`# Analytics: ${metricKey} (${aggregation})\n`);
  lines.push(
    `Period: ${new Date(startDate).toISOString().split("T")[0]} to ${new Date(endDate).toISOString().split("T")[0]}`,
  );
  if (params.groupBy) lines.push(`Grouped by: ${params.groupBy}`);
  lines.push("");

  lines.push(
    ...periodTable({ currentPeriod: result.currentPeriod ?? [], groupBy: params.groupBy }),
  );

  lines.push("\n> Tip: Use `discover_schema` to see all available metrics and aggregation types.");

  return lines.join("\n");
}
