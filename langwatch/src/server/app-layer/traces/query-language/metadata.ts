/**
 * Static metadata about the queryable trace fields. No liqe dependency,
 * no AST work — just the registry the rest of the query language reads.
 *
 * Adding a new field happens here and propagates everywhere:
 *   - SearchBar suggestions (FIELD_NAMES, FIELD_VALUES)
 *   - Sidebar facets / range controls (SEARCH_FIELDS.facetField, valueType)
 *   - Docs drawer + AI-mode prompt (composeQuerySyntaxDoc reads SEARCH_FIELDS)
 *   - Token highlight accent (SCENARIO_FIELDS)
 */

export type SearchFieldGroup =
  | "trace"
  | "span"
  | "event"
  | "eval"
  | "metrics"
  | "scenario"
  | "time";

export interface SearchFieldMeta {
  label: string;
  hasSidebar: boolean;
  facetField?: string;
  valueType: "categorical" | "range" | "text" | "existence";
  /**
   * Section the field belongs to in the autocomplete dropdown. Drives the
   * "Trace / Span / Event / Eval / Metrics" headers — same semantic
   * grouping the FilterSidebar uses, so the user's mental map matches in
   * both surfaces. Optional for now so we can land the metadata gradually
   * without forcing every new field through the registry.
   */
  group?: SearchFieldGroup;
}

export type FacetState = "neutral" | "include" | "exclude";

export const SEARCH_FIELDS: Readonly<Record<string, SearchFieldMeta>> = {
  origin: {
    label: "Origin",
    hasSidebar: true,
    facetField: "origin",
    valueType: "categorical",
    group: "trace",
  },
  status: {
    label: "Status",
    hasSidebar: true,
    facetField: "status",
    valueType: "categorical",
    group: "trace",
  },
  model: {
    label: "Model",
    hasSidebar: true,
    facetField: "model",
    valueType: "categorical",
    group: "span",
  },
  service: {
    label: "Service",
    hasSidebar: true,
    facetField: "service",
    valueType: "categorical",
    group: "span",
  },
  cost: {
    label: "Cost",
    hasSidebar: true,
    facetField: "cost",
    valueType: "range",
    group: "metrics",
  },
  duration: {
    label: "Duration",
    hasSidebar: true,
    facetField: "duration",
    valueType: "range",
    group: "metrics",
  },
  tokens: {
    label: "Tokens",
    hasSidebar: true,
    facetField: "tokens",
    valueType: "range",
    group: "metrics",
  },
  ttft: {
    label: "Time to first token",
    hasSidebar: true,
    facetField: "ttft",
    valueType: "range",
    group: "metrics",
  },
  ttlt: {
    label: "Time to last token",
    hasSidebar: true,
    facetField: "ttlt",
    valueType: "range",
    group: "metrics",
  },
  promptTokens: {
    label: "Prompt tokens",
    hasSidebar: true,
    facetField: "promptTokens",
    valueType: "range",
    group: "metrics",
  },
  completionTokens: {
    label: "Completion tokens",
    hasSidebar: true,
    facetField: "completionTokens",
    valueType: "range",
    group: "metrics",
  },
  tokensPerSecond: {
    label: "Tokens / second",
    hasSidebar: true,
    facetField: "tokensPerSecond",
    valueType: "range",
    group: "metrics",
  },
  spans: {
    label: "Span count",
    hasSidebar: true,
    facetField: "spans",
    valueType: "range",
    group: "span",
  },
  rootSpanType: {
    label: "Root span type",
    hasSidebar: true,
    facetField: "rootSpanType",
    valueType: "categorical",
    group: "span",
  },
  spanType: {
    label: "Span type",
    hasSidebar: true,
    facetField: "spanType",
    valueType: "categorical",
    group: "span",
  },
  rootSpanName: {
    label: "Root span name",
    hasSidebar: true,
    facetField: "rootSpanName",
    valueType: "categorical",
    group: "span",
  },
  guardrail: {
    label: "Guardrail",
    hasSidebar: true,
    facetField: "guardrail",
    valueType: "categorical",
    group: "trace",
  },
  annotation: {
    label: "Annotation",
    hasSidebar: true,
    facetField: "annotation",
    valueType: "categorical",
    group: "eval",
  },
  containsAi: {
    label: "Contains AI",
    hasSidebar: true,
    facetField: "containsAi",
    valueType: "categorical",
    group: "trace",
  },
  errorMessage: {
    label: "Error message",
    hasSidebar: true,
    facetField: "errorMessage",
    valueType: "categorical",
    group: "trace",
  },
  tokensEstimated: {
    label: "Tokens estimated",
    hasSidebar: true,
    facetField: "tokensEstimated",
    valueType: "categorical",
    group: "metrics",
  },
  prompt: {
    label: "Prompt ID",
    hasSidebar: false,
    valueType: "text",
    group: "trace",
  },
  selectedPrompt: {
    label: "Selected prompt",
    hasSidebar: true,
    facetField: "selectedPrompt",
    valueType: "categorical",
    group: "trace",
  },
  lastUsedPrompt: {
    label: "Last used prompt",
    hasSidebar: true,
    facetField: "lastUsedPrompt",
    valueType: "categorical",
    group: "trace",
  },
  promptVersion: {
    label: "Prompt version",
    hasSidebar: true,
    facetField: "promptVersion",
    valueType: "range",
    group: "trace",
  },
  user: {
    label: "User",
    hasSidebar: true,
    facetField: "user",
    valueType: "categorical",
    group: "trace",
  },
  conversation: {
    label: "Conversation",
    hasSidebar: true,
    facetField: "conversation",
    valueType: "categorical",
    group: "trace",
  },
  customer: {
    label: "Customer",
    hasSidebar: true,
    facetField: "customer",
    valueType: "categorical",
    group: "trace",
  },
  topic: {
    label: "Topic",
    hasSidebar: true,
    facetField: "topic",
    valueType: "categorical",
    group: "trace",
  },
  subtopic: {
    label: "Subtopic",
    hasSidebar: true,
    facetField: "subtopic",
    valueType: "categorical",
    group: "trace",
  },
  label: {
    label: "Label",
    hasSidebar: true,
    facetField: "label",
    valueType: "categorical",
    group: "trace",
  },
  scenario: {
    label: "Scenario",
    hasSidebar: false,
    valueType: "text",
    group: "scenario",
  },
  scenarioRun: {
    label: "Scenario run",
    hasSidebar: true,
    facetField: "scenarioRun",
    valueType: "categorical",
    group: "scenario",
  },
  scenarioSet: {
    label: "Scenario set",
    hasSidebar: false,
    valueType: "text",
    group: "scenario",
  },
  scenarioBatch: {
    label: "Scenario batch",
    hasSidebar: false,
    valueType: "text",
    group: "scenario",
  },
  scenarioVerdict: {
    label: "Scenario verdict",
    hasSidebar: false,
    valueType: "categorical",
    group: "scenario",
  },
  scenarioStatus: {
    label: "Scenario status",
    hasSidebar: false,
    valueType: "categorical",
    group: "scenario",
  },
  has: {
    label: "Has",
    hasSidebar: false,
    valueType: "existence",
    group: "trace",
  },
  none: {
    label: "None",
    hasSidebar: false,
    valueType: "existence",
    group: "trace",
  },
  event: {
    label: "Event name",
    hasSidebar: false,
    valueType: "text",
    group: "event",
  },
  eval: {
    label: "Eval",
    hasSidebar: false,
    valueType: "text",
    group: "eval",
  },
  evaluator: {
    label: "Evaluator",
    hasSidebar: true,
    facetField: "evaluator",
    valueType: "categorical",
    group: "eval",
  },
  evaluatorStatus: {
    label: "Evaluator status",
    hasSidebar: true,
    facetField: "evaluatorStatus",
    valueType: "categorical",
    group: "eval",
  },
  evaluatorVerdict: {
    label: "Evaluator verdict",
    hasSidebar: true,
    facetField: "evaluatorVerdict",
    valueType: "categorical",
    group: "eval",
  },
  evaluatorScore: {
    label: "Evaluator score",
    hasSidebar: true,
    facetField: "evaluatorScore",
    valueType: "range",
    group: "eval",
  },
  traceId: {
    label: "Trace ID",
    hasSidebar: false,
    valueType: "text",
    group: "trace",
  },
  spanId: {
    label: "Span ID",
    hasSidebar: false,
    valueType: "text",
    group: "span",
  },
  spanName: {
    label: "Span name",
    hasSidebar: true,
    facetField: "spanName",
    valueType: "categorical",
    group: "span",
  },
  spanStatus: {
    label: "Span status",
    hasSidebar: true,
    facetField: "spanStatus",
    valueType: "categorical",
    group: "span",
  },
};

/**
 * Namespaced dynamic prefixes — the user types one of these and then a
 * key (`trace.attribute.langwatch.user.id`) and the autocomplete drops
 * into key-discovery mode. Surfaced in the dropdown alongside the static
 * fields so users see them as first-class options.
 *
 * Keeping these as separate entries (not in `SEARCH_FIELDS`) because
 * they're not real fields — they're prefixes that expand to a concrete
 * field name once the user picks a key. The grammar's `isKnownField`
 * check accepts the expanded form.
 */
export interface DynamicPrefixDef {
  prefix: string;
  label: string;
  group: SearchFieldGroup;
  description: string;
}

export const DYNAMIC_PREFIXES: ReadonlyArray<DynamicPrefixDef> = [
  {
    prefix: "trace.attribute.",
    label: "Trace attribute",
    group: "trace",
    description: "Filter by a key on the trace's `Attributes` map",
  },
  {
    prefix: "span.attribute.",
    label: "Span attribute",
    group: "span",
    description: "Filter by a key on any span's `SpanAttributes` map",
  },
  {
    prefix: "event.attribute.",
    label: "Event attribute",
    group: "event",
    description: "Filter by a key on any span event's `Attributes` map",
  },
];

/** Field names whose tokens render with the scenario accent in the search bar. */
export const SCENARIO_FIELDS: ReadonlySet<string> = new Set([
  "scenario",
  "scenarioRun",
  "scenarioSet",
  "scenarioBatch",
  "scenarioVerdict",
  "scenarioStatus",
]);

export const FIELD_NAMES: ReadonlyArray<string> = Object.keys(SEARCH_FIELDS);

const HAS_NONE_VALUES: string[] = [
  "error",
  "eval",
  "feedback",
  "annotation",
  "conversation",
  "user",
  "customer",
  "topic",
  "subtopic",
  "label",
];

/** Known values for autocomplete suggestions. */
export const FIELD_VALUES: Record<string, string[]> = {
  status: ["error", "warning", "ok"],
  origin: ["application", "simulation", "evaluation", "sample"],
  has: HAS_NONE_VALUES,
  none: HAS_NONE_VALUES,
  scenarioVerdict: ["success", "failure", "inconclusive"],
  scenarioStatus: [
    "running",
    "success",
    "failed",
    "error",
    "cancelled",
    "stalled",
    "pending",
    "queued",
  ],
  evaluatorStatus: [
    "scheduled",
    "in_progress",
    "processed",
    "skipped",
    "error",
  ],
  evaluatorVerdict: ["pass", "fail", "unknown"],
  spanStatus: ["ok", "error", "unset"],
};
