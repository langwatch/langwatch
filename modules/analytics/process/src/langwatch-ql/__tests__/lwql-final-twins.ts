/**
 * The views pinned to latest-in-order, rendered a second time with the FINAL they replaced, in a
 * database of their own: the reference the latest-in-order proofs compare against (ADR-006).
 */
import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLViewDefinition } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import type { LangWatchQLClickHouseHarness } from "./lwql-clickhouse-harness.ts";

/** Every catalogue view that reads its table latest-in-order instead of FINAL. */
export const LATEST_IN_ORDER_VIEWS: readonly LangWatchQLViewDefinition[] = LWQL_VIEW_CATALOG.filter(
  (view) => view.dedup.strategy === "latest-in-order",
);

/**
 * Creates `<database>_final` holding a FINAL twin of each latest-in-order view, readable by the
 * suite's restricted identity, and returns its name. The twins read as the invoker, so the
 * identity's own row policies on the fact tables still apply.
 */
export async function provisionFinalTwins({
  harness,
}: {
  harness: LangWatchQLClickHouseHarness;
}): Promise<string> {
  const database = `${harness.names.database}_final`;
  const twins = LATEST_IN_ORDER_VIEWS.map((view) => ({
    ...view,
    dedup: { ...view.dedup, strategy: "final" as const },
  }));
  await harness.applyAsAdmin([
    `DROP DATABASE IF EXISTS ${database}`,
    `CREATE DATABASE ${database}`,
    ...LangWatchQLViewProvisioningService.create().setupStatements({
      names: { ...harness.names, database },
      sourceDatabase: harness.factDatabase,
      views: twins,
      dedup: "final",
    }),
    `GRANT SELECT ON ${database}.* TO ${harness.names.restrictedUser}`,
  ]);
  return database;
}

/** The SQL with every FROM or JOIN of a latest-in-order view pointed at its FINAL twin. */
export function readingFinalTwins({ sql, database }: { sql: string; database: string }): string {
  const names = LATEST_IN_ORDER_VIEWS.map((view) => view.name).join("|");
  return sql.replace(
    new RegExp(`\\b(FROM|JOIN)(\\s+)(?:analytics\\.)?(${names})\\b(?!\\.)`, "gi"),
    (_match, keyword: string, space: string, view: string) =>
      `${keyword}${space}${database}.${view}`,
  );
}
