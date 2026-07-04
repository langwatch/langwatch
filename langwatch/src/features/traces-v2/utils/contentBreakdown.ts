/**
 * Content-block cost breakdown (ADR-033), per trace or per span.
 *
 * The ingest classifier stamps each coding-agent span with per-category token +
 * cost totals under `langwatch.reserved.blockcat.<category>.{tokens,cost_usd}`,
 * and the trace fold rolls them up onto the trace summary. So the same numbers
 * are readable in two shapes with no extra query:
 *   - the TRACE header's `attributes` — a FLAT `Record<string,string>` (fold
 *     aggregate across the trace's spans);
 *   - a SPAN detail's `params` — the UNFLATTENED nested object the span mapper
 *     builds (`safeUnflatten`), so blockcat lives at
 *     `params.langwatch.reserved.blockcat.<category>.{tokens,cost_usd}`.
 *
 * Pure: data-in / rows-out. Zero-only categories are dropped, so content that
 * was never classified yields `[]` (the caller renders the section only when
 * there is something to show).
 */

import {
  type CategoryBreakdownBarRow,
  toCategoryBarRows,
} from "~/components/governance/CategoryBreakdownBars";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  CATEGORIES,
  type Category,
} from "~/server/app-layer/traces/block-classification/categories";

/** Build sorted bar rows from a per-category `{ tokens, costUsd }` accessor. */
function buildRows(
  get: (category: Category) => { costUsd: number; tokens: number },
): CategoryBreakdownBarRow[] {
  const rows = CATEGORIES.map((category) => ({ category, ...get(category) }))
    // Drop categories the content never touched; keep a lane that has tokens but
    // no cost (an unpriced/custom model), matching the /me + governance views.
    .filter((r) => r.costUsd > 0 || r.tokens > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
  return toCategoryBarRows(rows);
}

/** Rows from a trace header's FLAT attributes map (fold aggregate). */
export function traceContentBreakdownRows(
  attributes: Record<string, string> | null | undefined,
): CategoryBreakdownBarRow[] {
  if (!attributes) return [];
  return buildRows((category) => ({
    costUsd: Number(attributes[blockCategoryCostAttr(category)] ?? "0") || 0,
    tokens: Number(attributes[blockCategoryTokensAttr(category)] ?? "0") || 0,
  }));
}

/** Rows from a span detail's UNFLATTENED `params` (single-span totals). */
export function spanContentBreakdownRows(
  params: unknown,
): CategoryBreakdownBarRow[] {
  const blockcat = readNested(params, ["langwatch", "reserved", "blockcat"]);
  if (!blockcat || typeof blockcat !== "object") return [];
  const byCategory = blockcat as Record<string, unknown>;
  return buildRows((category) => {
    const entry = byCategory[category];
    const rec =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    return {
      costUsd: rec ? Number(rec.cost_usd ?? "0") || 0 : 0,
      tokens: rec ? Number(rec.tokens ?? "0") || 0 : 0,
    };
  });
}

/** Walk a dotted path through a (possibly null-prototype) nested object. */
function readNested(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
