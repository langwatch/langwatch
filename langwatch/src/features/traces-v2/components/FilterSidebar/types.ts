import type { SystemStyleObject } from "@chakra-ui/react";

export type FacetValueState = "neutral" | "include" | "exclude";

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
}

export interface AttributeKey {
  value: string;
  count: number;
}

export interface TooltipLine {
  text: string;
  negated: boolean;
}

export type SectionGroup = "trace" | "evaluation" | "span" | "metadata";

export type SectionKind = "cat" | "range" | "attributes";

export interface SectionBase {
  key: string;
  label: string;
  group?: SectionGroup;
}

export interface CategoricalSection extends SectionBase {
  kind: "cat";
  topValues: { value: string; label?: string; count: number }[];
}

export interface RangeSectionData extends SectionBase {
  kind: "range";
  min: number;
  max: number;
}

export interface AttributesSectionData extends SectionBase {
  kind: "attributes";
}

export type Section = CategoricalSection | RangeSectionData | AttributesSectionData;
