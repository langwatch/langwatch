import type { TemplateMatchInput } from "./templateContext";

/**
 * A single representative example trace that the editor preview, the test
 * fire, and the editor autocomplete all agree on (see ADR-028). Only one
 * match is exposed today — the variable surface is `match.*`, singular —
 * because the only live cadence is immediate. A digest cadence will later
 * expose `matches[]` as well.
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
 * Variables intentionally use the singular `match.*` rather than
 * `{% for m in matches %}` — immediate cadence has exactly one match, and a
 * `matches[]` iteration only makes sense once the digest cadence (ADR-025)
 * ships.
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
    path: "trigger.message",
    type: "string",
    description: "Optional free-form message stored on the automation.",
  },
  {
    path: "trigger.alertType",
    type: "'INFO' | 'WARNING' | 'CRITICAL' | null",
    description: "Severity label, or null if unset.",
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
