/**
 * The explore chart's three controls, and the two strings they drive: the
 * chart title and the query line under it.
 *
 * The query line is a sketch of the language every governance surface is
 * meant to compile through one day. Nothing parses it yet; it is copy, and
 * it is kept here as a pure mapping so the title and the line can never
 * disagree with the controls or with each other.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */

export type ExploreMeasure = "cost" | "requests" | "tokens" | "error_rate";
export type ExploreBreakdown =
  | "department"
  | "tool"
  | "model"
  | "person"
  | "project";
export type ExploreInterval = "day" | "week" | "month";

export interface ExploreSelection {
  measure: ExploreMeasure;
  breakdown: ExploreBreakdown;
  interval: ExploreInterval;
}

export const EXPLORE_MEASURES: ReadonlyArray<{
  value: ExploreMeasure;
  label: string;
  aggregate: string;
}> = [
  { value: "cost", label: "Cost", aggregate: "sum(cost)" },
  { value: "requests", label: "Requests", aggregate: "count()" },
  { value: "tokens", label: "Tokens", aggregate: "sum(tokens)" },
  { value: "error_rate", label: "Error rate", aggregate: "avg(is_error)" },
];

export const EXPLORE_BREAKDOWNS: ReadonlyArray<{
  value: ExploreBreakdown;
  label: string;
}> = [
  { value: "department", label: "Department" },
  { value: "tool", label: "Tool" },
  { value: "model", label: "Model" },
  { value: "person", label: "Person" },
  { value: "project", label: "Project" },
];

export const EXPLORE_INTERVALS: ReadonlyArray<{
  value: ExploreInterval;
  label: string;
  adverb: string;
  bin: string;
}> = [
  { value: "day", label: "Daily", adverb: "daily", bin: "1d" },
  { value: "week", label: "Weekly", adverb: "weekly", bin: "1w" },
  { value: "month", label: "Monthly", adverb: "monthly", bin: "1M" },
];

export const EXPLORE_WINDOWS = ["24h", "7d", "30d", "90d", "1y"] as const;
export type ExploreWindow = (typeof EXPLORE_WINDOWS)[number];
export const DEFAULT_EXPLORE_WINDOW: ExploreWindow = "30d";

export const DEFAULT_EXPLORE_SELECTION: ExploreSelection = {
  measure: "cost",
  breakdown: "department",
  interval: "week",
};

/** Named starting points. Each carries a whole selection, never a patch. */
export const EXPLORE_TEMPLATES: ReadonlyArray<{
  label: string;
  selection: ExploreSelection;
}> = [
  { label: "Spend by department", selection: DEFAULT_EXPLORE_SELECTION },
  {
    label: "Spend by tool",
    selection: { measure: "cost", breakdown: "tool", interval: "week" },
  },
  {
    label: "Requests by model",
    selection: { measure: "requests", breakdown: "model", interval: "day" },
  },
  {
    label: "Top people by spend",
    selection: { measure: "cost", breakdown: "person", interval: "week" },
  },
  {
    label: "Spend by project",
    selection: { measure: "cost", breakdown: "project", interval: "week" },
  },
  {
    label: "Error rate by department",
    selection: {
      measure: "error_rate",
      breakdown: "department",
      interval: "day",
    },
  },
];

function measureOf(selection: ExploreSelection) {
  return EXPLORE_MEASURES.find((m) => m.value === selection.measure)!;
}
function intervalOf(selection: ExploreSelection) {
  return EXPLORE_INTERVALS.find((i) => i.value === selection.interval)!;
}

/** "Cost by department · weekly" — full words, the same ones the query uses. */
export function exploreChartTitle(selection: ExploreSelection): string {
  return `${measureOf(selection).label} by ${selection.breakdown} · ${intervalOf(selection).adverb}`;
}

/** "usage | summarize sum(cost) by department, bin(1w)" */
export function exploreQueryLine(selection: ExploreSelection): string {
  return `usage | summarize ${measureOf(selection).aggregate} by ${selection.breakdown}, bin(${intervalOf(selection).bin})`;
}

/** Whether a selection is exactly one of the templates. */
export function matchesTemplate(
  selection: ExploreSelection,
  template: { selection: ExploreSelection },
): boolean {
  return (
    selection.measure === template.selection.measure &&
    selection.breakdown === template.selection.breakdown &&
    selection.interval === template.selection.interval
  );
}
