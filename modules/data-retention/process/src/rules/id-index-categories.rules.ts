import type { IdIndexDeclaration } from "@langwatch/clickhouse-client";
import type { RetentionCategory } from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";

/**
 * Each declared id index retention rewrites itself, with its source's category: the ones that
 * copy their source's retention, over a source one category governs. The event log's index is
 * eventing's to rewrite, per row; an index over an ungoverned source keeps its own retention.
 */
export function idIndexCategories({
  declarations,
  eventLogIndex,
}: {
  declarations: readonly IdIndexDeclaration[];
  eventLogIndex: string;
}): ReadonlyMap<string, RetentionCategory> {
  const categories = new Map<string, RetentionCategory>();
  for (const declaration of declarations) {
    if (declaration.retention !== "copied" || declaration.index === eventLogIndex) continue;
    for (const [table, category] of Object.entries(RETENTION_TABLE_CATEGORY_MAP)) {
      if (table === declaration.source) categories.set(declaration.index, category);
    }
  }
  return categories;
}
