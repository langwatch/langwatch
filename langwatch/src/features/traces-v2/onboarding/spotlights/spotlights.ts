/**
 * Flat list of spotlight definitions for the trace-explorer tour.
 *
 * A spotlight is one contextual callout anchored to a `data-spotlight`
 * DOM attribute. The overlay walks through this list linearly — no state
 * machine, no branching. Each entry ships a short body (1–2 sentences)
 * and an optional title rendered as a header in the popover.
 *
 * Preconditions (`isApplicable`) let individual spotlights opt out at
 * runtime (e.g. "evaluator drilldown" when no evaluators are visible),
 * but the common case is applicability === true so the default omits the
 * field entirely.
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
   * Conditional surfaces (the evaluator drilldown only exists when a
   * row is expanded; the viz tabs only exist with the drawer open)
   * point at an always-present stand-in instead — without one, the
   * overlay used to silently walk forward past every missing anchor
   * and end the four-step tour after step two.
   */
  fallbackAnchor?: string;
}

export const TRACE_EXPLORER_SPOTLIGHTS: Spotlight[] = [
  {
    id: "search-bar",
    // Anchor on the Ask AI chip rather than the whole search bar. The
    // chip is the load-bearing piece of this callout (the tour is
    // selling the natural-language input, not the typed expression
    // language), and a popover next to a small target reads as "this
    // thing here" instead of looping the eye around the entire row.
    // The chip carries its own red "AI" glow, so we anchor outside
    // the existing visual treatment — orange ring on the chip, copy
    // floats to the right.
    anchor: "ask-ai-chip",
    title: "Find anything, fast",
    body: 'Type a filter, or hit Ask AI (⌘I) and describe what you want — "errors from the checkout agent in the last hour, slowest first". The query language is full-featured; the AI lane is the fastest path to a useful view.',
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
