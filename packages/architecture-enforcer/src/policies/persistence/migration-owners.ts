import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import {
  clickhouseScanAt,
  clickhouseScanOf,
  clickhouseTableOwners,
  type ClickhouseScan,
  upStatements,
} from "./clickhouse-table-ownership.ts";
import { featureClaims, prismaModelNames } from "./prisma-table-ownership.ts";

/**
 * SQL stays central and each migration is attributed to its tables' owner, so
 * one touching two owners is refused (Alex, 2026-10-06, D3). Migrations below
 * the cutoffs are frozen history (ruling BL-1), squashed per owner after merge.
 */

const POLICY = "migration-owners";
const PRISMA_MIGRATIONS = "packages/prisma-client/prisma/migrations";
const CLICKHOUSE_MIGRATIONS = "packages/clickhouse-migrations/migrations";
const FROZEN_BELOW = { postgres: "20260914", clickhouse: "00089" } as const;
const SQL_COMMENT = /--[^\n]*/g;
const MATERIALISED_SUFFIX = /_mv$/;
const ALLOWED =
  "Split the migration so each file touches one owner's tables; SQL stays central and each migration is attributed to its owner (Alex, 2026-10-06, D3).";

const POSTGRES_NAME = `(?:"?public"?\\.)?"?([A-Za-z_]\\w*)"?`;
const POSTGRES_TOUCH = new RegExp(
  `\\b(?:CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE(?:\\s+IF\\s+EXISTS)?(?:\\s+ONLY)?|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|INSERT\\s+INTO|UPDATE|TRUNCATE(?:\\s+TABLE)?|FROM|JOIN|INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?"?\\w+"?\\s+ON(?:\\s+ONLY)?)\\s+${POSTGRES_NAME}`,
  "gi",
);
const CLICKHOUSE_NAME = "(?:\\$\\{[^}]*\\}\\.)?`?([A-Za-z_]\\w*)`?";
const CLICKHOUSE_TOUCH = new RegExp(
  `\\b(?:CREATE\\s+(?:MATERIALIZED\\s+VIEW|TABLE|VIEW)(?:\\s+IF\\s+NOT\\s+EXISTS)?|DROP\\s+(?:TABLE|VIEW)(?:\\s+IF\\s+EXISTS)?|ALTER\\s+TABLE|INSERT\\s+INTO|OPTIMIZE\\s+TABLE|TRUNCATE\\s+TABLE|RENAME\\s+TABLE|FROM|JOIN|TO)\\s+${CLICKHOUSE_NAME}`,
  "gi",
);

/** One migration file and the tables it touches, grouped by owner. */
export type MigrationOwners = { file: string; owners: Map<string, string[]> };

type Source = { files: string[]; touch: RegExp; owners: ReadonlyMap<string, string> };

/** Table name to owning module, read from each module's Prisma claims. */
export function postgresOwners(root: string, catalogue: readonly FeatureCatalogueEntry[]) {
  const models = prismaModelNames({ root, policy: POLICY });
  const owners = new Map<string, string>();

  for (const claim of catalogue.flatMap((feature) => featureClaims(root, feature, []))) {
    const table = models.get(claim.model);
    if (table && !owners.has(table)) owners.set(table, claim.feature);
  }

  return owners;
}

function prismaMigrationFiles(root: string): string[] {
  const directory = join(root, PRISMA_MIGRATIONS);
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name >= FROZEN_BELOW.postgres)
    .map((entry) => `${PRISMA_MIGRATIONS}/${entry.name}/migration.sql`)
    .filter((file) => existsSync(join(root, file)));
}

function clickhouseMigrationFiles(root: string): string[] {
  const directory = join(root, CLICKHOUSE_MIGRATIONS);
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql") && name >= FROZEN_BELOW.clickhouse)
    .map((name) => `${CLICKHOUSE_MIGRATIONS}/${name}`);
}

function ownerOfName(owners: ReadonlyMap<string, string>, name: string): string | undefined {
  return owners.get(name) ?? owners.get(name.replace(MATERIALISED_SUFFIX, ""));
}

function ownersOf({ sql, source }: { sql: string; source: Source }): Map<string, string[]> {
  const touched = new Map<string, string[]>();

  for (const match of sql.matchAll(source.touch)) {
    const table = match[1] ?? "";
    const owner = ownerOfName(source.owners, table);
    if (!owner) continue;
    const tables = touched.get(owner) ?? [];
    if (!tables.includes(table)) tables.push(table);
    touched.set(owner, tables);
  }

  return touched;
}

/** Every migration touching more than one owner's tables, sorted by path. */
export function twoOwnerMigrations({
  root,
  catalogue,
  clickhouse,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
  clickhouse: ClickhouseScan;
}): MigrationOwners[] {
  const sources: Source[] = [
    {
      files: prismaMigrationFiles(root),
      touch: POSTGRES_TOUCH,
      owners: postgresOwners(root, catalogue),
    },
    {
      files: clickhouseMigrationFiles(root),
      touch: CLICKHOUSE_TOUCH,
      owners: clickhouseTableOwners({ scan: clickhouse }),
    },
  ];

  return sources
    .flatMap((source) =>
      source.files.map((file) => {
        const text = readFileSync(join(root, file), "utf8");
        const sql = upStatements(text).replace(SQL_COMMENT, "");

        return { file, owners: ownersOf({ sql, source }) };
      }),
    )
    .filter((migration) => migration.owners.size > 1)
    .toSorted((left, right) => left.file.localeCompare(right.file));
}

function violationOf({ root, migration }: { root: string; migration: MigrationOwners }) {
  const named = [...migration.owners]
    .map(([owner, tables]) => `${owner} (${tables.join(", ")})`)
    .join(" and ");

  return {
    policy: POLICY,
    file: join(root, migration.file),
    message: `This migration touches the tables of ${migration.owners.size} owners: ${named}.`,
    allowed: ALLOWED,
  } satisfies ArchitectureViolation;
}

/** The check over a root, for fixtures: reads the ClickHouse tree itself. */
export function lintMigrationOwnersAt({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): ArchitectureViolation[] {
  const clickhouse = clickhouseScanAt(root, catalogue);

  return twoOwnerMigrations({ root, catalogue, clickhouse }).map((migration) =>
    violationOf({ root, migration }),
  );
}

/** The registry entry: shares the ClickHouse scan with clickhouse-table-ownership. */
export function lintMigrationOwners(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, catalogue } = snapshot;
  const clickhouse = clickhouseScanOf(snapshot);

  return twoOwnerMigrations({ root, catalogue, clickhouse }).map((migration) =>
    violationOf({ root, migration }),
  );
}
