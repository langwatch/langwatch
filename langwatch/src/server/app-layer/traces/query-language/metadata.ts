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

export interface SearchFieldMeta {
  label: string;
  hasSidebar: boolean;
  facetField?: string;
  valueType: "categorical" | "range" | "text" | "existence";
}

export type FacetState = "neutral" | "include" | "exclude";

export const SEARCH_FIELDS: Readonly<Record<string, SearchFieldMeta>> = {
  origin: {
    label: "Origin",
    hasSidebar: true,
    facetField: "origin",
    valueType: "categorical",
  },
  status: {
    label: "Status",
    hasSidebar: true,
    facetField: "status",
    valueType: "categorical",
  },
  model: {
    label: "Model",
    hasSidebar: true,
    facetField: "model",
    valueType: "categorical",
  },
  service: {
    label: "Service",
    hasSidebar: true,
    facetField: "service",
    valueType: "categorical",
  },
  cost: {
    label: "Cost",
    hasSidebar: true,
    facetField: "cost",
    valueType: "range",
  },
  duration: {
    label: "Duration",
    hasSidebar: true,
    facetField: "duration",
    valueType: "range",
  },
  tokens: {
    label: "Tokens",
    hasSidebar: true,
    facetField: "tokens",
    valueType: "range",
  },
  ttlt: {
    label: "Time to Last Token",
    hasSidebar: true,
    facetField: "ttlt",
    valueType: "range",
  },
  promptTokens: {
    label: "Prompt tokens",
    hasSidebar: true,
    facetField: "promptTokens",
    valueType: "range",
  },
  completionTokens: {
    label: "Completion tokens",
    hasSidebar: true,
    facetField: "completionTokens",
    valueType: "range",
  },
  tokensPerSecond: {
    label: "Tokens / second",
    hasSidebar: true,
    facetField: "tokensPerSecond",
    valueType: "range",
  },
  spans: {
    label: "Span Count",
    hasSidebar: true,
    facetField: "spans",
    valueType: "range",
  },
  rootSpanType: {
    label: "Root span type",
    hasSidebar: true,
    facetField: "rootSpanType",
    valueType: "categorical",
  },
  rootSpanName: {
    label: "Root span name",
    hasSidebar: true,
    facetField: "rootSpanName",
    valueType: "categorical",
  },
  guardrail: {
    label: "Guardrail",
    hasSidebar: true,
    facetField: "guardrail",
    valueType: "categorical",
  },
  annotation: {
    label: "Annotation",
    hasSidebar: true,
    facetField: "annotation",
    valueType: "categorical",
  },
  containsAi: {
    label: "Contains AI",
    hasSidebar: true,
    facetField: "containsAi",
    valueType: "categorical",
  },
  errorMessage: {
    label: "Error message",
    hasSidebar: true,
    facetField: "errorMessage",
    valueType: "categorical",
  },
  tokensEstimated: {
    label: "Tokens estimated",
    hasSidebar: true,
    facetField: "tokensEstimated",
    valueType: "categorical",
  },
  prompt: { label: "Prompt ID", hasSidebar: false, valueType: "text" },
  selectedPrompt: {
    label: "Selected prompt",
    hasSidebar: true,
    facetField: "selectedPrompt",
    valueType: "categorical",
  },
  lastUsedPrompt: {
    label: "Last used prompt",
    hasSidebar: true,
    facetField: "lastUsedPrompt",
    valueType: "categorical",
  },
  promptVersion: {
    label: "Prompt version",
    hasSidebar: true,
    facetField: "promptVersion",
    valueType: "range",
  },
  user: { label: "User", hasSidebar: false, valueType: "text" },
  conversation: { label: "Conversation", hasSidebar: false, valueType: "text" },
  scenario: { label: "Scenario", hasSidebar: false, valueType: "text" },
  scenarioRun: { label: "Scenario run", hasSidebar: false, valueType: "text" },
  scenarioSet: { label: "Scenario set", hasSidebar: false, valueType: "text" },
  scenarioBatch: {
    label: "Scenario batch",
    hasSidebar: false,
    valueType: "text",
  },
  scenarioVerdict: {
    label: "Scenario verdict",
    hasSidebar: false,
    valueType: "categorical",
  },
  scenarioStatus: {
    label: "Scenario status",
    hasSidebar: false,
    valueType: "categorical",
  },
  has: { label: "Has", hasSidebar: false, valueType: "existence" },
  none: { label: "None", hasSidebar: false, valueType: "existence" },
  event: { label: "Event", hasSidebar: false, valueType: "text" },
  eval: { label: "Eval", hasSidebar: false, valueType: "text" },
  evaluatorStatus: {
    label: "Evaluator Status",
    hasSidebar: true,
    facetField: "evaluatorStatus",
    valueType: "categorical",
  },
  evaluatorVerdict: {
    label: "Evaluator Verdict",
    hasSidebar: true,
    facetField: "evaluatorVerdict",
    valueType: "categorical",
  },
  evaluatorScore: {
    label: "Evaluator Score",
    hasSidebar: true,
    facetField: "evaluatorScore",
    valueType: "range",
  },
  traceId: { label: "Trace ID", hasSidebar: false, valueType: "text" },
  spanId: { label: "Span ID", hasSidebar: false, valueType: "text" },
};

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
};
