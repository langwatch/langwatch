/**
 * Flat list of spotlight definitions for the trace-explorer tour.
 */

export interface SpotlightContext {
  hasEvaluators: boolean;
  hasFlameViz: boolean;
}

export interface Spotlight {
  id: string;
  /**
   * The `data-spotlight` attribute value on the target DOM element,
   * e.g. `"search-bar"` matches `[data-spotlight="search-bar"]`.
   */
  anchor: string;
  /** Optional heading rendered in bold above the body. */
  title?: string;
  /** 1–2 sentence explanation of the element. */
  body: string;
  /**
   * Popover placement hint. Defaults to "bottom".
   * Values match Chakra / Floating UI placement strings.
   */
  placement?: "top" | "bottom" | "left" | "right";
  /**
   * Optional precondition. When it returns false the spotlight is
   * skipped while walking forward or backward through the list.
   */
  isApplicable?: (ctx: SpotlightContext) => boolean;
  /**
   * Anchor to fall back to when the primary anchor isn't in the DOM.
   */
  fallbackAnchor?: string;
}

export const TRACE_EXPLORER_SPOTLIGHTS: Spotlight[] = [
  {
    id: "search-bar",
    // Anchor on the ask chip rather than the whole search bar.
    anchor: "ask-ai-chip",
    title: "Find anything, fast",
    body: 'Type a filter, or press ⌘I and describe what you want — "errors from the checkout agent in the last hour, slowest first". The query language is full-featured; plain English is the fastest path to a useful view.',
    placement: "right",
  },
  {
    id: "facets",
    anchor: "facet-sidebar",
    title: "Filter by facet",
    body: "Each facet narrows the view by a single field — model, evaluator score, error status, and more. Hold ⇧ or ⌘ while clicking to combine rows with OR.",
    placement: "right",
  },
  {
    id: "evaluator-drill",
    anchor: "evaluator-drilldown",
    fallbackAnchor: "evaluator-section",
    title: "Evaluator drilldown",
    body: "Click an evaluator row to see pass/fail counts and a score slider — no query needed.",
    placement: "right",
    isApplicable: ({ hasEvaluators }) => hasEvaluators,
  },
  {
    id: "drawer-viz",
    anchor: "viz-tabs",
    fallbackAnchor: "trace-table",
    title: "Four views, one trace",
    body: "Open any trace and switch between Waterfall, Flame, Topology, or Sequence — same data, a different lens for each question.",
    placement: "bottom",
  },
];

/**
 * Condition-gated, show-once spotlights for the trace drawer. Unlike the page tour
 * above, these aren't a linear walkthrough: each one appears exactly once, the first
 * time the user opens a drawer where the feature is actually present.
 */
export const DRAWER_SPOTLIGHTS: Spotlight[] = [
  {
    id: "conversation-context",
    anchor: "conversation-context",
    title: "Conversation context",
    body: "This trace is one turn of a longer conversation — click any neighbouring turn to jump to it.",
    placement: "bottom",
  },
  {
    id: "drawer-io",
    anchor: "drawer-io",
    title: "Input & output",
    body: "The trace's computed input and output, with raw / markdown / JSON views.",
    placement: "bottom",
  },
  {
    id: "drawer-evals",
    anchor: "drawer-evals",
    title: "Evaluations",
    body: "Evaluator verdicts and scores recorded against this trace.",
    placement: "bottom",
  },
  {
    id: "drawer-events",
    anchor: "drawer-events",
    title: "Events",
    body: "Point-in-time events your spans emitted, on the trace timeline.",
    placement: "bottom",
  },
];
