import { getQueryReference, type QueryReferenceResponse } from "../langwatch-api-query.js";
import { analyticsGroups } from "../schemas/analytics-groups.js";
import { analyticsMetrics } from "../schemas/analytics-metrics.js";
import { markdownTable } from "../utils/markdown-table.js";

export type Category = "filters" | "lwql" | "metrics" | "aggregations" | "groups" | "all";

/**
 * Categories the platform answers, not this package — which is why
 * `formatSchema` is async: they are read from `GET /api/v1/query/reference`
 * and need the API key.
 */
const PLATFORM_BACKED: ReadonlySet<Category> = new Set(["filters", "lwql", "all"]);

export function needsQueryReference(category: Category): boolean {
  return PLATFORM_BACKED.has(category);
}

/**
 * Formats the LangWatch query schema into markdown an agent can act on.
 * `reference` is required for the platform-backed categories and ignored by
 * the others, so a caller that fetched it once can reuse it.
 */
export async function formatSchema(
  category: Category,
  reference?: QueryReferenceResponse,
): Promise<string> {
  const sections: string[] = [];
  const resolved =
    needsQueryReference(category) && !reference ? await getQueryReference() : reference;

  if (category === "filters" || category === "all") {
    sections.push(formatFilters(resolved));
  }
  if (category === "lwql" || category === "all") {
    sections.push(formatLangWatchQL(resolved));
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
  if (category === "all" && resolved) {
    sections.push(formatDecisionTable(resolved));
  }

  return sections.join("\n\n");
}

/** What the field's values column says: the closed set, or where to read an open one. */
const knownValuesCell = (field: { knownValues: readonly string[]; facetable: boolean }): string => {
  if (field.knownValues.length > 0) return field.knownValues.join(", ");
  return field.facetable ? "open set, read them from GET /api/v1/traces/facets" : "";
};

function formatFilters(reference?: QueryReferenceResponse): string {
  if (!reference) {
    return "## Trace Filter Fields\n\nUnavailable: the platform could not be reached.";
  }
  const lines = ["## Trace Filter Fields", ""];
  lines.push(
    "Send one of these as the `filter` parameter of `search_traces`, in the language the Trace Explorer's search bar speaks: `status:error AND model:gpt-*`.",
  );
  lines.push(
    "The `filters` parameter is the older per-field map and still works; both are combined when you send both.",
  );
  lines.push("");
  lines.push(
    markdownTable({
      headers: ["Field", "Type", "Group", "Known values"],
      rows: reference.traceFilter.fields.map((field) => ({
        Field: field.name,
        Type: field.valueType,
        Group: field.group ?? "",
        "Known values": knownValuesCell(field),
      })),
    }),
  );
  lines.push("");
  lines.push("### Attribute namespaces", "");
  lines.push(
    markdownTable({
      headers: ["Prefix", "Matches", "Older spellings"],
      rows: reference.traceFilter.dynamicPrefixes.map((prefix) => ({
        Prefix: `${prefix.prefix}<key>`,
        Matches: prefix.description,
        "Older spellings": prefix.aliases.join(", "),
      })),
    }),
  );
  lines.push("");
  lines.push("### Syntax", "");
  lines.push(reference.traceFilter.syntax);
  lines.push("");
  lines.push("### Worked filters", "");
  for (const example of reference.examples.filter(
    (candidate) => candidate.language === "trace-filter",
  )) {
    lines.push(`- \`${example.text}\` — ${example.title}`);
  }
  return lines.join("\n");
}

function formatLangWatchQL(reference?: QueryReferenceResponse): string {
  if (!reference) {
    return "## Analytics SQL\n\nUnavailable: the platform could not be reached.";
  }
  if (!reference.lwql.enabled) {
    return [
      "## Analytics SQL",
      "",
      "Not enabled for this project, so `run_query` will refuse. Use `search_traces` and `get_analytics` instead.",
    ].join("\n");
  }
  const lines = ["## Analytics SQL", ""];
  lines.push(
    "Run one read-only SELECT with `run_query`. The statement is executed as written: nothing rewrites it.",
  );
  lines.push(
    `Ceilings: ${reference.lwql.limits.maxRowsReturned} rows, ${reference.lwql.limits.maxExecutionTimeSeconds} seconds. ${reference.lwql.limits.pagination}`,
  );
  lines.push("");
  for (const view of reference.lwql.schema.views) {
    lines.push(`### ${view.name}`);
    lines.push(`${view.description} One row is: ${view.grain}`);
    lines.push(
      `Filter on \`${view.timeColumn}\` to prune partitions. Join keys: ${view.joinKeys.join(", ") || "none"}.`,
    );
    lines.push("");
    lines.push(
      markdownTable({
        headers: ["Column", "Type", "Available", "Description"],
        rows: view.columns.map((column) => ({
          Column: column.name,
          Type: column.type,
          Available: column.available ? "yes" : `needs ${column.gates.join(", ")}`,
          Description: column.description,
        })),
      }),
    );
    lines.push("");
  }
  lines.push("### Worked statements", "");
  for (const example of reference.examples.filter((candidate) => candidate.language === "lwql")) {
    lines.push(
      `**${example.title}**${example.available ? "" : ` (needs ${example.requires.gates.join(", ")})`}`,
    );
    lines.push("```sql");
    lines.push(example.text);
    lines.push("```");
    for (const parameter of example.parameters) {
      lines.push(`- \`{${parameter.name}:${parameter.type}}\` — ${parameter.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatDecisionTable(reference: QueryReferenceResponse): string {
  const lines = ["## Which one to reach for", ""];
  lines.push(
    markdownTable({
      headers: ["When you want", "Use", "Why"],
      rows: reference.decisionTable.map((row) => ({
        "When you want": row.when,
        Use: row.use,
        Why: row.why,
      })),
    }),
  );
  return lines.join("\n");
}

function formatMetrics(): string {
  const lines = ["## Available Metrics", ""];
  lines.push("Use these in `get_analytics` as `metric` parameter in `category.name` format.");
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
  lines.push("Use these in the `groupBy` parameter of `get_analytics`.");
  lines.push("");
  for (const g of analyticsGroups) {
    lines.push(`- **${g.name}** (${g.label}): ${g.description}`);
  }
  return lines.join("\n");
}
