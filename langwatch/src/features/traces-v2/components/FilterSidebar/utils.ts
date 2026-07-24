import { HelpCircle, type LucideIcon } from "lucide-react";
import { formatBytes } from "../../utils/formatters";
import { ORIGIN_DISPLAY, originLabel } from "../../utils/originDisplay";
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
  // Origin labels come from the shared display table so the sidebar
  // facet rows and the Origin column badge agree on casing
  // ("Coding Agent", "AI Tool" — not "Coding_agent"). Unknown origins
  // fall through to the generic title-casing below.
  if (field === "origin" && value in ORIGIN_DISPLAY) return originLabel(value);
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

/**
 * How many of a facet's values actually have matching traces — the number
 * shown in the section header's value-count badge.
 *
 * A categorical section keeps its default-value scaffolding visible even at
 * zero hits (STATUS always lists OK / Error / Warning; spanType lists the full
 * type set) so any of them is one click away to filter on. The badge, though,
 * should answer "how many of these values are present in the data right now?",
 * so it counts only `count > 0`. Without this, STATUS reads "3" while only OK
 * has traces. The zero-count rows stay in the list — this only changes the
 * tally. The "(none)" toggle row isn't a FacetItem, so it's never counted.
 */
export function countPresentValues(
  items: readonly { count: number }[],
): number {
  return items.reduce((n, item) => (item.count > 0 ? n + 1 : n), 0);
}

/**
 * Compact count — K above a thousand, rounded integer below. Shared base
 * for the token / span formatters, which only differ in the unit suffix
 * appended on top. Kept unit-less so each facet can stamp its own
 * ("12.3K tok", "8 spans", "575/s").
 */
const compactCount = (v: number) =>
  v >= TOKEN_K ? `${(v / TOKEN_K).toFixed(1)}K` : String(Math.round(v));

// Range endpoints have no per-endpoint header to carry the unit (unlike the
// table columns), so each numeric facet stamps its own compact suffix. "16"
// vs "16 tok" / "16 spans" / "16/s" is the difference between an ambiguous
// number and a self-describing one.
const formatTokensUnit = (v: number) => `${compactCount(v)} tok`;

const formatSpansUnit = (v: number) => {
  const rounded = Math.round(v);
  return `${rounded.toLocaleString()} ${rounded === 1 ? "span" : "spans"}`;
};

const formatPerSecond = (v: number) => `${compactCount(v)}/s`;

const formatMs = (v: number) =>
  v >= TOKEN_K ? `${(v / TOKEN_K).toFixed(1)}s` : `${Math.round(v)}ms`;

const formatDollars = (v: number) => `$${v.toFixed(4)}`;

const RANGE_FORMATTERS: Record<string, (v: number) => string> = {
  // Spend + the token counts that drive it.
  cost: formatDollars,
  tokens: formatTokensUnit,
  promptTokens: formatTokensUnit,
  completionTokens: formatTokensUnit,
  // Latency / throughput.
  duration: formatMs,
  ttft: formatMs,
  ttlt: formatMs,
  tokensPerSecond: formatPerSecond,
  // Volume.
  spans: formatSpansUnit,
  size: formatBytes,
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
