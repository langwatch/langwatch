import type { TemplateMatchInput } from "./templateContext";

/**
 * A single representative example trace that the editor preview, the test
 * fire, and the editor autocomplete all agree on (see ADR-036). Both
 * `matches[]` (canonical iteration surface, exposed at every cadence) and
 * `match.*` (singular shortcut, `matches[0]`) are available to templates;
 * an immediate fire simply has `matches.length === 1`.
 */
export const EXAMPLE_MATCH: TemplateMatchInput = {
  traceId: "trace_2x9fK3aQ",
  input: "What is the capital of France?",
  output: "The capital of France is Paris.",
  metadata: { customer_id: "cust_123", topic: "geography" },
  evaluation: {
    score: 0.92,
    passed: true,
    label: "relevant",
    evaluatorName: "Answer Relevancy",
  },
};

/** Kept as an array so the existing render path (which iterates `matches`)
 *  continues to work unchanged. Internally `match = matches[0]`. */
export const EXAMPLE_MATCHES: TemplateMatchInput[] = [EXAMPLE_MATCH];

/**
 * Rich variable information surfaced to the editor: dotted path + TypeScript-ish
 * type signature + optional human description. The same array drives Monaco
 * autocomplete (`detail` + `documentation`), the unknown-variable detector
 * (roots = `path.split(".")[0]`), and the Variable Reference panel.
 *
 * Both `match.*` (singular handle for immediate dispatches) and `matches[]`
 * (iterable for both immediate and digest) are surfaced in the variable
 * panel. ADR-036 picks the digest-friendly default — authors writing
 * `{% for m in matches %}` get correct behavior in both modes from one
 * template, while `{{ match.field }}` stays a convenient shortcut for
 * single-match cases.
 */
export interface VariableInfo {
  /** Dotted path the template author writes, e.g. `match.trace.input`. */
  path: string;
  /** TypeScript-ish type signature, e.g. `string | null`. */
  type: string;
  /** One-line description shown in autocomplete documentation. */
  description?: string;
}

export const TEMPLATE_VARIABLES: VariableInfo[] = [
  {
    path: "trigger.id",
    type: "string",
    description: "Stable identifier of the automation.",
  },
  {
    path: "trigger.name",
    type: "string",
    description: "The automation's configured name.",
  },
  {
    path: "trigger.alertType",
    type: "'INFO' | 'WARNING' | 'CRITICAL' | null",
    description: "Severity label, or null if unset.",
  },
  {
    path: "trigger.editUrl",
    type: "string",
    description: "Deep link to this automation's edit page.",
  },
  {
    path: "project.name",
    type: "string",
    description: "Human-readable project name.",
  },
  {
    path: "project.slug",
    type: "string",
    description: "URL-safe project slug.",
  },
  {
    path: "project.url",
    type: "string",
    description: "Absolute URL to the project home.",
  },
  {
    path: "digest.count",
    type: "number",
    description: "1 for immediate cadence; N for a digest.",
  },
  {
    path: "digest.windowStart",
    type: "string | null",
    description: "ISO-8601 — only set for digest cadences.",
  },
  {
    path: "digest.windowEnd",
    type: "string | null",
    description: "ISO-8601 — only set for digest cadences.",
  },
  {
    path: "matches",
    type: "TemplateMatchVars[]",
    description:
      "Canonical iteration surface. Immediate dispatch has length 1, a digest has N — iterate with `{% for m in matches %}` and the same template handles both.",
  },
  {
    path: "match.trace.id",
    type: "string | null",
    description: "Trace ID that matched the conditions.",
  },
  {
    path: "match.trace.input",
    type: "string",
    description: "Captured input of the matched trace.",
  },
  {
    path: "match.trace.output",
    type: "string",
    description: "Captured output of the matched trace.",
  },
  {
    path: "match.trace.url",
    type: "string",
    description: "Deep link to the matched trace.",
  },
  {
    path: "match.trace.metadata",
    type: "object",
    description: "Trace metadata as a key/value object.",
  },
  {
    path: "match.evaluation.score",
    type: "number | null",
    description: "Evaluation score, when the trigger is evaluation-bound.",
  },
  {
    path: "match.evaluation.passed",
    type: "boolean | null",
    description: "Evaluation passed/failed verdict.",
  },
  {
    path: "match.evaluation.label",
    type: "string | null",
    description: "Optional evaluation label.",
  },
  {
    path: "match.evaluation.evaluatorName",
    type: "string | null",
    description: "Display name of the evaluator that ran.",
  },
];

/** Notification cadence the variable surface is filtered for. Only "immediate"
 *  is live today; "digest" is reserved for ADR-026. */
export type TemplateCadence = "immediate" | "digest";

/** Filters the variable list down to what's *actually available* at the given
 *  cadence. `matches[]` (and the `match.*` shortcut) are exposed at every
 *  cadence; the only variables hidden for immediate fires are the window-bound
 *  ones — `digest.windowStart` / `digest.windowEnd` are null outside a digest
 *  payload, so we hide them so authors don't reach for variables that always
 *  render empty. */
export function filterVariablesForCadence(
  variables: VariableInfo[],
  cadence: TemplateCadence,
): VariableInfo[] {
  if (cadence === "digest") return variables;
  return variables.filter(
    (v) => v.path !== "digest.windowStart" && v.path !== "digest.windowEnd",
  );
}
