import {
  clickhouseScanAt,
  clickhouseTableOwners,
} from "../policies/persistence/clickhouse-table-ownership.ts";
import { postgresOwners } from "../policies/persistence/migration-owners.ts";
import type { FeatureCatalogueEntry } from "../types.ts";

/**
 * Table name (as migration SQL spells it) to owning module id, the attribution
 * migration-owners uses, sorted by table. A table owned by no catalogued module,
 * or by different modules in Postgres and ClickHouse, is left out.
 */
export function tableOwnerMap({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): Record<string, string> {
  const modules = new Set(catalogue.map((feature) => feature.id));
  const sources = [
    postgresOwners(root, catalogue),
    clickhouseTableOwners({ scan: clickhouseScanAt(root, catalogue) }),
  ];
  const owners = new Map<string, string | null>();

  for (const [table, owner] of sources.flatMap((source) => [...source])) {
    const known = owners.get(table);
    owners.set(table, known === undefined || known === owner ? owner : null);
  }

  return Object.fromEntries(
    [...owners]
      .filter((entry): entry is [string, string] => entry[1] !== null && modules.has(entry[1]))
      .toSorted(([left], [right]) => Number(left > right) - Number(left < right)),
  );
}
