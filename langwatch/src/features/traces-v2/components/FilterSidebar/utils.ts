import { HelpCircle, type LucideIcon } from "lucide-react";
import {
  FACET_ICONS,
  FACET_LABELS,
  GROUP_ICONS,
  NORMAL_CASE_FIELDS,
  SECTION_ORDER,
} from "./constants";
import type { SectionGroup } from "./types";

const TOKEN_K = 1_000;
const TOKEN_M = 1_000_000;

export function facetLabel(value: string, field: string): string {
  const override = FACET_LABELS[value];
  if (override) return override;
  if (NORMAL_CASE_FIELDS.has(field)) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}

export function getFacetIcon({
  key,
  group,
}: {
  key: string;
  group?: SectionGroup;
}): LucideIcon {
  return FACET_ICONS[key] ?? (group && GROUP_ICONS[group]) ?? HelpCircle;
}

export function sortBySectionOrder<T extends { key: string; label: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.key);
    const bi = SECTION_ORDER.indexOf(b.key);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.label.localeCompare(b.label);
  });
}

export function paletteFromColor(color: unknown): string {
  if (typeof color !== "string") return "gray";
  const dotIndex = color.indexOf(".");
  return dotIndex === -1 ? color : color.slice(0, dotIndex);
}

export function formatCount(count: number): string {
  if (count >= TOKEN_M) return `${(count / TOKEN_M).toFixed(1)}M`;
  if (count >= TOKEN_K) return `${(count / TOKEN_K).toFixed(1)}K`;
  return String(count);
}

const formatTokens = (v: number) =>
  v >= TOKEN_K ? `${(v / TOKEN_K).toFixed(1)}K` : String(Math.round(v));

const formatMs = (v: number) =>
  v >= TOKEN_K ? `${(v / TOKEN_K).toFixed(1)}s` : `${Math.round(v)}ms`;

const formatDollars = (v: number) => `$${v.toFixed(4)}`;

const RANGE_FORMATTERS: Record<string, (v: number) => string> = {
  tokens: formatTokens,
  cost: formatDollars,
  duration: formatMs,
  ttft: formatMs,
};

const DEFAULT_RANGE_FORMATTER = (v: number) => String(Math.round(v));

export function getRangeFormatter(field: string): (v: number) => string {
  return RANGE_FORMATTERS[field] ?? DEFAULT_RANGE_FORMATTER;
}

export function summarizeRange({
  from,
  to,
  format,
}: {
  from: number | undefined;
  to: number | undefined;
  format: (v: number) => string;
}): string {
  if (from !== undefined && to !== undefined) {
    return `${format(from)} – ${format(to)}`;
  }
  if (from !== undefined) return `≥ ${format(from)}`;
  if (to !== undefined) return `≤ ${format(to)}`;
  return "active";
}
