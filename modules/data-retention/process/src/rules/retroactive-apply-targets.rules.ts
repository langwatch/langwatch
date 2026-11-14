import type { RetentionCategory } from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";

/** The rewrite of eventing's tables, issued once: eventing classifies each of its rows itself. */
export const EVENTING_APPLY_TARGET = "eventing" as const;

export type RetroactiveApplyPlan = Readonly<{
  /** Each rewrite an apply issues, in order; a redelivery skips the ones already issued. */
  targets: string[];
  /** The tables the apply names to its caller, from declarations alone. */
  tables: string[];
  /** Every table the category's map names, eventing's included. */
  mappedTables: string[];
  /** The category's own tables, eventing's excluded. */
  categoryTables: string[];
  /** The id indexes copying the category's retention; each is raised only where held. */
  categoryIndexes: string[];
}>;

/** What applying `category` rewrites, worked out from the module's declarations only. */
export function retroactiveApplyPlan({
  category,
  idIndexCategories,
  eventingTables,
}: {
  category: RetentionCategory;
  idIndexCategories: ReadonlyMap<string, RetentionCategory>;
  eventingTables: readonly string[];
}): RetroactiveApplyPlan {
  const mapped = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
    .filter(([, tableCategory]) => tableCategory === category)
    .map(([table]) => table);
  const categoryIndexes = [...idIndexCategories]
    .filter(([, indexCategory]) => indexCategory === category)
    .map(([index]) => index);
  const categoryTables = mapped.filter((table) => !eventingTables.includes(table));
  return {
    targets: [EVENTING_APPLY_TARGET, ...categoryTables, ...categoryIndexes],
    tables: [...new Set([...mapped, ...categoryIndexes, ...eventingTables])],
    mappedTables: mapped,
    categoryTables,
    categoryIndexes,
  };
}
