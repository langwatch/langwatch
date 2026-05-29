import type { TemplateMatchInput } from "./templateContext";

/**
 * The canonical example data a trigger template renders against. One source of
 * truth shared by the live preview, the test fire, and the editor's
 * autocomplete/validation (see ADR-026), so all three agree on the shape. The
 * trigger/project identity is filled in per-trigger at render time; only the
 * matched-trace data here is synthetic.
 */
export const EXAMPLE_MATCHES: TemplateMatchInput[] = [
  {
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
  },
];

/**
 * Dotted paths a template can reference, used to drive editor autocomplete and
 * to flag unknown-variable typos. `m` is the conventional loop variable from
 * `{% for m in matches %}` (the framework defaults use it).
 */
export const TEMPLATE_VARIABLE_PATHS: string[] = [
  "trigger.id",
  "trigger.name",
  "trigger.message",
  "trigger.alertType",
  "project.name",
  "project.slug",
  "project.url",
  "digest.count",
  "digest.windowStart",
  "digest.windowEnd",
  "matches",
  "m.trace.id",
  "m.trace.input",
  "m.trace.output",
  "m.trace.url",
  "m.trace.metadata",
  "m.evaluation.score",
  "m.evaluation.passed",
  "m.evaluation.label",
  "m.evaluation.evaluatorName",
];
