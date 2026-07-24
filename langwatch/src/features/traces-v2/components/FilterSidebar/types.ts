import type { SystemStyleObject } from "@chakra-ui/react";

export type FacetValueState = "neutral" | "include" | "exclude";

/**
 * Per-value aggregates the evaluator facet attaches so its sidebar
 * drilldown can render verdict pills + score range inline without
 * firing a second query per evaluator. Other facets leave this absent.
 */
export interface FacetItemAggregates {
  passedCount: number;
  failedCount: number;
  erroredCount: number;
  scoreMin: number | null;
  scoreMax: number | null;
  hasScore: boolean;
  /** Count of distinct non-null score values — drives whether the score
   *  slider is worth showing (see EvaluatorDrilldown's meaningful-score gate). */
  distinctScores: number;
  hasLabel: boolean;
  /** Top distinct emitted-label values + counts (capped server-side). The
   *  drilldown renders these as clickable rows that filter on `evaluatorLabel`.
   *  Absent / empty when the evaluator emits no labels. */
  labelValues?: { value: string; count: number }[];
}

export interface FacetItem {
  value: string;
  label: string;
  count: number;
  dotColor?: NonNullable<SystemStyleObject["color"]>;
  /**
   * When true, the row's palette tint is rendered at reduced opacity so the
   * hashed colours of secondary fields (model, service, topic, …) don't shout
   * as loudly as the curated palettes for status / origin / spanType.
   */
  dimmed?: boolean;
  /**
   * Synthesised from FACET_DEFAULTS while real descriptors are still
   * loading. The row is fully interactive (toggles still apply against
   * the AST) but count + value-bar are hidden — the count would be `0`
   * and the bar would render empty until real data lands, which read
   * as "no matches" rather than "loading."
   */
  synthetic?: boolean;
  /** Set only for the evaluator facet — see {@link FacetItemAggregates}. */
  aggregates?: FacetItemAggregates;
}

export interface AttributeKey {
  value: string;
  count: number;
}

export interface TooltipLine {
  text: string;
  negated: boolean;
}

export type SectionGroup =
  | "trace"
  | "evaluation"
  | "span"
  | "metadata"
  | "prompt";

export type SectionKind = "cat" | "range" | "attributes";

export interface SectionBase {
  key: string;
  label: string;
  group?: SectionGroup;
}

export interface CategoricalSection extends SectionBase {
  kind: "cat";
  topValues: {
    value: string;
    label?: string;
    count: number;
    /**
     * Forwarded from the discover response. Only set on the evaluator
     * facet (its query builder emits the matching SQL aggregates) —
     * other facets leave it absent. Surfaced here so the sidebar's
     * drilldown can read per-evaluator pass/fail / score range
     * without firing a second query.
     */
    aggregates?: FacetItemAggregates;
  }[];
  /**
   * True when this section was synthesised from FACET_DEFAULTS before the
   * discover response arrived (or when the project has no traces yet).
   * Used to show a "No values yet" placeholder instead of an empty list.
   */
  synthetic?: boolean;
}

export interface RangeSectionData extends SectionBase {
  kind: "range";
  min: number;
  max: number;
  /**
   * Present only for `discrete`-flagged integer facets (e.g. prompt version,
   * span count): the distinct values + counts that back the "Discrete"
   * tick-list, plus the true distinct count. The sidebar offers Discrete only
   * when `distinctCount` is within `DISCRETE_MODE_MAX_VALUES`; otherwise the
   * facet stays a slider.
   */
  discrete?: {
    values: { value: number; count: number }[];
    distinctCount: number;
  };
  /**
   * True when this descriptor was synthesised from RANGE_DEFAULTS before
   * discover responded. The range section renders a placeholder caption
   * instead of an interactive slider so the user knows the filter will
   * populate once traces arrive.
   */
  synthetic?: boolean;
}

export interface AttributesSectionData extends SectionBase {
  kind: "attributes";
  /**
   * Filter-language prefix used to dispatch toggles for this section.
   * `attribute` → `attribute.<key>:<value>` (legacy / trace.attribute alias).
   * `span.attribute` → `span.attribute.<key>:<value>` (any-span match).
   * `event.attribute` → `event.attribute.<key>:<value>` (any span event match).
   * Keeping it on the section, not the consumer, lets one render path
   * serve trace, span, and event attribute lists.
   */
  filterPrefix: "attribute" | "span.attribute" | "event.attribute";
  /** The discovered attribute keys for this section (with counts). */
  keys: AttributeKey[];
  /**
   * Cosmetic prefix stripped from each key's DISPLAYED label only (e.g.
   * `metadata.` → "environment" instead of "metadata.environment"). The full
   * key is still used to build the filter, so it resolves to the same
   * underlying trace-attribute predicate. Absent on the trace/span/event
   * attribute sections, which display keys verbatim.
   */
  displayStripPrefix?: string;
  /**
   * When set, the section renders even with zero discovered keys and its empty
   * state links here (how to start emitting these attributes). Used by the
   * always-visible Metadata facet so it teaches rather than disappearing.
   */
  emptyDocsHref?: string;
}

export type Section =
  | CategoricalSection
  | RangeSectionData
  | AttributesSectionData;
