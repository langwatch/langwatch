/**
 * Worked trace filter queries: the fields and the grammar do not answer "what
 * does a real query look like", and a model handed the field list writes
 * `status:failed`. Published for the query reference door.
 * @see specs/analytics/query-reference.feature
 */

import type { QueryExampleIntent } from "@langwatch/analytics-contract";

/** One worked trace filter query. */
export interface TraceFilterExample {
  /** Stable identifier, unique across both example libraries. */
  readonly id: string;
  readonly title: string;
  readonly intent: QueryExampleIntent;
  /** Free tags an agent can filter on, beyond the single intent. */
  readonly tags: readonly string[];
  /** The filter string, exactly as it should be sent. */
  readonly text: string;
  /** What to notice about it, when there is something. */
  readonly notes?: string;
}

/**
 * The library. Values are real (`error`, `application`, `gpt-*`) except where
 * an example is about the caller's own data, and then they are placeholders.
 */
export const TRACE_FILTER_EXAMPLES: readonly TraceFilterExample[] = [
  {
    id: "filter.failures",
    title: "Traces that failed",
    intent: "triage",
    tags: ["errors", "starter"],
    text: "status:error",
    notes: "The error lives on a span, not in the trace's text, so free text does not find it.",
  },
  {
    id: "filter.failures-from-the-application",
    title: "Failures from the application, not from evaluations or simulations",
    intent: "triage",
    tags: ["errors", "origin"],
    text: "origin:application AND status:error",
    notes:
      "A project's traces include evaluation, simulation and playground runs. Bound on origin first or you are triaging your own test traffic.",
  },
  {
    id: "filter.slow-and-expensive",
    title: "Slow and expensive at once",
    intent: "cost",
    tags: ["latency", "cost", "ranges"],
    text: "duration:>5000 AND cost:>0.10",
    notes: "Comparison and range forms work on every numeric field.",
  },
  {
    id: "filter.one-model-failing",
    title: "One model family failing",
    intent: "triage",
    tags: ["errors", "models", "wildcards"],
    text: "status:error AND model:gpt-*",
  },
  {
    id: "filter.evaluation-failures",
    title: "Traces an evaluator marked failed",
    intent: "quality",
    tags: ["evaluations"],
    text: "evaluatorVerdict:fail",
  },
  {
    id: "filter.low-score-for-one-evaluator",
    title: "One evaluator scoring low",
    intent: "quality",
    tags: ["evaluations", "ranges"],
    text: 'evaluator:"Answer Relevancy" AND evaluatorScore:<0.5',
    notes:
      "The evaluator name is the one shown in the product. Check the spelling with the facets endpoint.",
  },
  {
    id: "filter.one-conversation",
    title: "Every turn of one conversation",
    intent: "conversations",
    tags: ["conversations"],
    text: 'conversation:"conv-01H8XK"',
    notes:
      "Conversation identity is the OTel `gen_ai.conversation.id` attribute. Not every trace carries one.",
  },
  {
    id: "filter.traces-with-a-conversation",
    title: "Only traces that belong to a conversation",
    intent: "conversations",
    tags: ["conversations", "existence"],
    text: "has:conversation",
    notes:
      "Useful before a conversation-level read: on some projects most traces carry no conversation id.",
  },
  {
    id: "filter.one-user",
    title: "One user's traces",
    intent: "discovery",
    tags: ["users"],
    text: 'user:"alice@example.com"',
  },
  {
    id: "filter.trace-attribute",
    title: "A trace-level attribute you send yourself",
    intent: "discovery",
    tags: ["attributes"],
    text: "trace.attribute.langwatch.user_id:alice",
    notes:
      "Any key in the trace's attribute map. `attribute.<key>` is the older spelling and still works.",
  },
  {
    id: "filter.span-attribute",
    title: "An attribute on any span of the trace",
    intent: "discovery",
    tags: ["attributes", "spans"],
    text: "span.attribute.gen_ai.request.model:gpt-5-mini",
    notes: "Matches when at least one span in the trace carries the key with that value.",
  },
  {
    id: "filter.event-attribute",
    title: "An exception type recorded as a span event",
    intent: "triage",
    tags: ["attributes", "events", "errors"],
    text: "event.attribute.exception.type:TimeoutError",
  },
  {
    id: "filter.tool-span-failed",
    title: "A tool call that failed",
    intent: "triage",
    tags: ["spans", "errors"],
    text: "spanType:tool AND spanStatus:error",
  },
  {
    id: "filter.free-text",
    title: "A phrase anywhere in the captured input or output",
    intent: "discovery",
    tags: ["free-text", "starter"],
    text: '"refund policy"',
    notes:
      "Free text reads the captured input and output plus the trace and span names. It is a substring match, so `AND`, `OR` and `NOT` inside the quotes are searched for as words.",
  },
  {
    id: "filter.exclude-the-successes",
    title: "Everything except the clean runs",
    intent: "triage",
    tags: ["negation"],
    text: "origin:application AND NOT status:ok",
    notes:
      "`NOT` and the `-` shorthand both negate. Operators are case-sensitive and must be uppercase.",
  },
];
