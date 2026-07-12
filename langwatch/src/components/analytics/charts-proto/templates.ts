/**
 * charts-proto — curated dashboard templates (PROTOTYPE, strategy S4).
 *
 * The empty-state on-ramp: click a template and a fully-built dashboard appears,
 * ready to tweak. Each template is just a list of widget specs (query + viz +
 * grid footprint) — the same shape a user authors by hand in the builder.
 */
import type { DimensionColumn, WidgetSpec } from "./model";

export type TemplateWidget = Omit<WidgetSpec, "id">;

export interface DashboardTemplate {
  key: string;
  name: string;
  description: string;
  widgets: TemplateWidget[];
}

const w = (
  title: string,
  visualization: WidgetSpec["visualization"],
  aggregations: WidgetSpec["aggregations"],
  groupBy: DimensionColumn[],
  colSpan: number,
  rowSpan: number,
  filter = "",
): TemplateWidget => ({
  title,
  visualization,
  aggregations,
  groupBy,
  filter,
  timeRangeMode: "inherit",
  colSpan,
  rowSpan,
});

export const TEMPLATES: DashboardTemplate[] = [
  {
    key: "cost",
    name: "Cost Overview",
    description: "Spend at a glance — totals, by model, and over time.",
    widgets: [
      w("Total cost", "stat", [{ op: "sum", column: "cost" }], [], 3, 1),
      w("Avg cost / trace", "stat", [{ op: "avg", column: "cost" }], [], 3, 1),
      w("Traces", "stat", [{ op: "count" }], [], 3, 1),
      w("Models in use", "stat", [{ op: "cardinality", column: "cost" }], [], 3, 1),
      w("Cost by model", "bar", [{ op: "sum", column: "cost" }], ["model"], 6, 2),
      w("Cost over time", "line", [{ op: "sum", column: "cost" }], ["model"], 6, 2),
      w(
        "Cost & volume by topic",
        "table",
        [
          { op: "sum", column: "cost" },
          { op: "avg", column: "cost" },
          { op: "count" },
        ],
        ["topicId"],
        12,
        2,
      ),
    ],
  },
  {
    key: "latency",
    name: "Latency & Performance",
    description: "Percentile latency, where the slow paths are, and the trend.",
    widgets: [
      w("p95 latency", "stat", [{ op: "p95", column: "durationMs" }], [], 3, 1),
      w("p50 latency", "stat", [{ op: "p50", column: "durationMs" }], [], 3, 1),
      w("Slowest single call", "stat", [{ op: "max", column: "durationMs" }], [], 3, 1),
      w("Tokens / sec", "stat", [{ op: "avg", column: "tokensPerSecond" }], [], 3, 1),
      w("p95 latency by model", "bar", [{ op: "p95", column: "durationMs" }], ["model"], 6, 2),
      w("p95 latency over time", "line", [{ op: "p95", column: "durationMs" }], ["model"], 6, 2),
      w(
        "Latency percentiles by model",
        "table",
        [
          { op: "p50", column: "durationMs" },
          { op: "p95", column: "durationMs" },
          { op: "p99", column: "durationMs" },
          { op: "count" },
        ],
        ["model"],
        12,
        2,
      ),
    ],
  },
  {
    key: "errors",
    name: "Error Analysis",
    description: "Where failures concentrate — by status, model, and over time.",
    widgets: [
      w("Failed traces", "stat", [{ op: "count" }], [], 4, 1, "has_error:true"),
      w("Errored traces by status", "bar", [{ op: "count" }], ["hasError"], 8, 1),
      w("Errors by model", "bar", [{ op: "count" }], ["model"], 6, 2, "has_error:true"),
      w("Errors over time", "line", [{ op: "count" }], ["hasError"], 6, 2),
      w(
        "Volume & errors by topic",
        "table",
        [{ op: "count" }, { op: "cardinality", column: "durationMs" }],
        ["topicId", "hasError"],
        12,
        2,
      ),
    ],
  },
  {
    key: "models",
    name: "Model Comparison",
    description: "Compare volume, latency, cost, and tokens across models.",
    widgets: [
      w(
        "Model scorecard",
        "table",
        [
          { op: "count" },
          { op: "p95", column: "durationMs" },
          { op: "avg", column: "cost" },
          { op: "sum", column: "totalTokens" },
        ],
        ["model"],
        12,
        2,
      ),
      w("Requests by model", "bar", [{ op: "count" }], ["model"], 6, 2),
      w("Avg cost by model", "bar", [{ op: "avg", column: "cost" }], ["model"], 6, 2),
      w("Total tokens over time", "line", [{ op: "sum", column: "totalTokens" }], ["model"], 12, 2),
    ],
  },
];
