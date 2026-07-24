import { filterFields } from "../schemas/filter-fields.js";
import { analyticsMetrics } from "../schemas/analytics-metrics.js";
import { analyticsGroups } from "../schemas/analytics-groups.js";

export type Category =
  | "filters"
  | "metrics"
  | "aggregations"
  | "groups"
  | "all";

/**
 * Formats the LangWatch analytics schema into human-readable markdown.
 *
 * Returns documentation for the requested category of schema elements
 * (filter fields, metrics, aggregation types, or group-by options).
 */
export function formatSchema(category: Category): string {
  const sections: string[] = [];

  if (category === "filters" || category === "all") {
    sections.push(formatFilters());
  }
  if (category === "metrics" || category === "all") {
    sections.push(formatMetrics());
  }
  if (category === "aggregations" || category === "all") {
    sections.push(formatAggregations());
  }
  if (category === "groups" || category === "all") {
    sections.push(formatGroups());
  }

  return sections.join("\n\n");
}

function formatFilters(): string {
  const lines = ["## Available Filter Fields", ""];
  lines.push(
    "Use these in the `filters` parameter of `search_traces` and `get_analytics`."
  );
  lines.push('Format: `{ "field_name": ["value1", "value2"] }`');
  lines.push("");
  for (const f of filterFields) {
    lines.push(
      `- **${f.field}**: ${f.description}${f.example ? ` (e.g., \`${f.example}\`)` : ""}`
    );
  }
  return lines.join("\n");
}

function formatMetrics(): string {
  const lines = ["## Available Metrics", ""];
  lines.push(
    "Use these in `get_analytics` as `metric` parameter in `category.name` format."
  );
  lines.push("");

  const byCategory = new Map<string, typeof analyticsMetrics>();
  for (const m of analyticsMetrics) {
    const list = byCategory.get(m.category) || [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  for (const [cat, metrics] of byCategory) {
    lines.push(`### ${cat}`);
    for (const m of metrics) {
      lines.push(`- **${cat}.${m.name}** (${m.label}): ${m.description}`);
      lines.push(`  Aggregations: ${m.allowedAggregations.join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatAggregations(): string {
  return [
    "## Available Aggregation Types",
    "",
    "- **cardinality**: Count unique values",
    "- **terms**: Distribution/breakdown of values",
    "- **avg**: Average",
    "- **sum**: Sum total",
    "- **min**: Minimum",
    "- **max**: Maximum",
    "- **median**: 50th percentile",
    "- **p90**: 90th percentile",
    "- **p95**: 95th percentile",
    "- **p99**: 99th percentile",
    "",
    "Note: Not all aggregations are available for all metrics. Check the metric's allowed aggregations.",
  ].join("\n");
}

function formatGroups(): string {
  const lines = ["## Available Group-By Options", ""];
  lines.push(
    "Use these in the `groupBy` parameter of `get_analytics`."
  );
  lines.push("");
  for (const g of analyticsGroups) {
    lines.push(`- **${g.name}** (${g.label}): ${g.description}`);
  }
  return lines.join("\n");
}
