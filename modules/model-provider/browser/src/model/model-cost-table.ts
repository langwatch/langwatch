/** Filtering and ordering of the Model Costs table rows. Contract: specs/model-provider.feature. */

import type { LLMModelCostRow } from "./llm-model-cost-row.ts";
import { ruleVerdict } from "./regex-rule.ts";

export type ModelCostSortKey = "model" | "inputCostPerToken" | "outputCostPerToken";
export type ModelCostSort = { key: ModelCostSortKey; direction: "asc" | "desc" };

/** The provider is the part of the model name before its first "/". */
export function providerOf(row: LLMModelCostRow): string {
  return row.model.includes("/") ? row.model.split("/")[0]! : "other";
}

/** A first click sorts ascending, a second descending, a third restores the default order. */
export function nextSort(args: { current: ModelCostSort | null; key: ModelCostSortKey }) {
  const { current, key } = args;
  if (current?.key !== key) return { key, direction: "asc" as const };
  return current.direction === "asc" ? { key, direction: "desc" as const } : null;
}

export function filterAndSortCosts(args: {
  rows: LLMModelCostRow[];
  search: string;
  /** A model string: keep only rows whose regex rule matches it. */
  matchModel?: string;
  provider: string;
  customOnly: boolean;
  sort: ModelCostSort | null;
}): LLMModelCostRow[] {
  const { rows, provider, customOnly, sort } = args;
  const needle = args.search.trim().toLowerCase();
  const matchModel = args.matchModel?.trim();
  const visible = rows.filter(
    (row) =>
      (!matchModel || ruleVerdict({ regex: row.regex, model: matchModel }) === "match") &&
      (!needle ||
        row.model.toLowerCase().includes(needle) ||
        row.regex.toLowerCase().includes(needle)) &&
      (!provider || providerOf(row) === provider) &&
      (!customOnly || !!row.id),
  );
  if (!sort) return visible;
  const sign = sort.direction === "asc" ? 1 : -1;
  // Rows with no rate stay last in both directions.
  return visible.toSorted((a, b) => {
    if (sort.key === "model") return sign * a.model.localeCompare(b.model);
    const left = a[sort.key];
    const right = b[sort.key];
    if (left === undefined || right === undefined)
      return Number(left === undefined) - Number(right === undefined);
    return sign * (left - right);
  });
}
