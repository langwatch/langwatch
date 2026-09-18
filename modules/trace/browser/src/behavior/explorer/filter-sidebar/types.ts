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
   * Synthesised from FACET_DEFAULTS while real descriptors are still loading.
   */
  synthetic?: boolean;
  /** Set only for the evaluator facet — see {@link FacetItemAggregates}. */
  aggregates?: FacetItemAggregates;
  /** Set only for the event facet — see {@link EventMetricValues}. */
  eventMetrics?: EventMetricValues[];
}

/**
 * Per-metric-key value tallies the event facet attaches so its drilldown
 * (thumbs_up_down → vote values) renders from the discover payload without a second
 * query.
 */
export interface EventMetricValues {
  /** Full storage key, e.g. `event.metrics.vote` — display strips the
   *  prefix, filtering keeps the full key. */
  key: string;
  values: { value: string; count: number }[];
}

export interface AttributeKey {
  value: string;
  count: number;
}

export interface TooltipLine {
  text: string;
  negated: boolean;
}

export type SectionGroup = "trace" | "evaluation" | "span" | "metadata" | "prompt";

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
     * Forwarded from the discover response. Only set on the evaluator facet (its query
     * builder emits the matching SQL aggregates) — other facets leave it absent.
     */
    aggregates?: FacetItemAggregates;
    /** Forwarded from the discover response. Only set on the event facet —
     *  drives the per-event metric drilldown. */
    eventMetrics?: EventMetricValues[];
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
   * Present only for `discrete`-flagged integer facets (e.g. prompt version, span
   * count): the distinct values + counts that back the "Discrete" tick-list, plus the
   * true distinct count.
   */
  discrete?: {
    values: { value: number; count: number }[];
    distinctCount: number;
  };
  /**
   * True when this descriptor was synthesised from RANGE_DEFAULTS before discover
   * responded. The range section renders a placeholder caption instead of an
   * interactive slider so the user knows the filter will populate once traces arrive.
   */
  synthetic?: boolean;
}

export interface AttributesSectionData extends SectionBase {
  kind: "attributes";
  /**
   * Filter-language prefix used to dispatch toggles for this section. `attribute` →
   * `attribute.<key>:<value>` (legacy / trace.attribute alias). `span.attribute` →
   * `span.attribute.<key>:<value>` (any-span match).
   */
  filterPrefix: "attribute" | "span.attribute" | "event.attribute";
  /** The discovered attribute keys for this section (with counts). */
  keys: AttributeKey[];
  /**
   * Cosmetic prefix stripped from each key's DISPLAYED label only (e.g. `metadata.` →
   * "environment" instead of "metadata.environment"). The full key is still used to
   * build the filter, so it resolves to the same underlying trace-attribute predicate.
   */
  displayStripPrefix?: string;
  /**
   * When set, the section renders even with zero discovered keys and its empty
   * state links here (how to start emitting these attributes). Used by the
   * always-visible Metadata facet so it teaches rather than disappearing.
   */
  emptyDocsHref?: string;
}

export type Section = CategoricalSection | RangeSectionData | AttributesSectionData;
