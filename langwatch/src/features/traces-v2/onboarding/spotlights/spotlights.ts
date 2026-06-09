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
}

export const TRACE_EXPLORER_SPOTLIGHTS: Spotlight[] = [
  {
    id: "search-bar",
    anchor: "search-bar",
    title: "Search",
    body: "Type a filter expression to narrow the table. Press ⌘I (or Ctrl+I) to describe what you want in plain English.",
    placement: "bottom",
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
    title: "Evaluator drilldown",
    body: "Click an evaluator row to see pass/fail counts and a score slider — no query needed.",
    placement: "right",
    isApplicable: ({ hasEvaluators }) => hasEvaluators,
  },
  {
    id: "drawer-viz",
    anchor: "viz-tabs",
    title: "Four views, one trace",
    body: "Open any trace and switch between Waterfall, Flame, Topology, or Sequence — same data, a different lens for each question.",
    placement: "bottom",
  },
];
