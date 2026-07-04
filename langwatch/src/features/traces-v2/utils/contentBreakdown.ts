/**
 * Per-trace content-block cost breakdown (ADR-033).
 *
 * The ingest classifier stamps each coding-agent span with per-category token +
 * cost totals, and the trace fold rolls them up onto the trace summary under
 * `langwatch.reserved.blockcat.<category>.{tokens,cost_usd}`. Those aggregated
 * totals ride on the trace header's `attributes` map, so a per-trace breakdown
 * needs no extra query — it reads the same numbers the fold already summed and
 * the Metadata section already surfaces raw.
 *
 * Pure: attributes-in / rows-out. Zero-only categories are dropped, so a trace
 * with no classified coding-agent content yields `[]` (the caller renders the
 * section only when there is something to show).
 */

import {
  type CategoryBreakdownBarRow,
  toCategoryBarRows,
} from "~/components/governance/CategoryBreakdownBars";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  CATEGORIES,
} from "~/server/app-layer/traces/block-classification/categories";

export function traceContentBreakdownRows(
  attributes: Record<string, string> | null | undefined,
): CategoryBreakdownBarRow[] {
  if (!attributes) return [];
  const rows = CATEGORIES.map((category) => ({
    category,
    costUsd: Number(attributes[blockCategoryCostAttr(category)] ?? "0") || 0,
    tokens: Number(attributes[blockCategoryTokensAttr(category)] ?? "0") || 0,
  }))
    // Drop categories the trace never touched; keep a lane that has tokens but
    // no cost (an unpriced/custom model), matching the /me + governance views.
    .filter((r) => r.costUsd > 0 || r.tokens > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
  return toCategoryBarRows(rows);
}
