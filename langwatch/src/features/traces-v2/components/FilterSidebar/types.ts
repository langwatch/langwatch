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
  hasLabel: boolean;
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
}

export interface RangeSectionData extends SectionBase {
  kind: "range";
  min: number;
  max: number;
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
}

export type Section =
  | CategoricalSection
  | RangeSectionData
  | AttributesSectionData;
