import { getAnalyticsTimeseries as apiGetAnalytics } from "../langwatch-api.js";
import { parseRelativeDate } from "../utils/date-parsing.js";

/**
 * Handles the get_analytics MCP tool invocation.
 *
 * Queries analytics timeseries from LangWatch and formats the results
 * as an AI-readable markdown table.
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
  const startDate = params.startDate
    ? parseRelativeDate(params.startDate)
    : now - 7 * 86400000;
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
    `Period: ${new Date(startDate).toISOString().split("T")[0]} to ${new Date(endDate).toISOString().split("T")[0]}`
  );
  if (params.groupBy) lines.push(`Grouped by: ${params.groupBy}`);
  lines.push("");

  const currentPeriod = result.currentPeriod ?? [];
  if (currentPeriod.length === 0) {
    lines.push("No data available for this period.");
  } else {
    lines.push("| Date | Value |");
    lines.push("|------|-------|");
    for (const bucket of currentPeriod) {
      const date = bucket.date;
      // Find the metric value - it's typically keyed by index
      const value =
        Object.entries(bucket).find(
          ([k]) => k !== "date" && typeof bucket[k] === "number"
        )?.[1] ?? "N/A";
      lines.push(`| ${date} | ${value} |`);
    }
  }

  lines.push(
    "\n> Tip: Use `discover_schema` to see all available metrics and aggregation types."
  );

  return lines.join("\n");
}
