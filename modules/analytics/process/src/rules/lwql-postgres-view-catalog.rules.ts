/**
 * LangWatchQL analytics SQL — the PostgreSQL-resident half of the catalog, assembled from the
 * derivation.
 */

import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service.ts";
import {
  derivePostgresCatalog,
  type PostgresDatasetOverride,
} from "./lwql-postgres-catalog-derivation.rules.ts";
import { CONTENT_POSTGRES_OVERRIDES } from "./lwql-postgres-content-overrides.rules.ts";
import { CORE_POSTGRES_OVERRIDES } from "./lwql-postgres-core-overrides.rules.ts";
import { DESCRIPTIONS_POSTGRES_OVERRIDES } from "./lwql-postgres-descriptions-overrides.rules.ts";
import { PARENTS_POSTGRES_OVERRIDES } from "./lwql-postgres-parents-overrides.rules.ts";
import { SENSITIVE_POSTGRES_OVERRIDES } from "./lwql-postgres-sensitive-overrides.rules.ts";
import { LWQL_POSTGRES_SKIPPED_MODELS } from "./lwql-postgres-skipped-models.rules.ts";
import { TOPICS_POSTGRES_OVERRIDES } from "./lwql-postgres-topics-overrides.rules.ts";
import { VISIBILITY_POSTGRES_OVERRIDES } from "./lwql-postgres-visibility-overrides.rules.ts";
import { LWQL_PRISMA_MANIFEST } from "./lwql-prisma-manifest.rules.ts";

/** Combines two override maps model-by-model, not key-by-key. */
function mergePostgresOverride(
  base: PostgresDatasetOverride | undefined,
  addition: PostgresDatasetOverride,
): PostgresDatasetOverride {
  return {
    ...base,
    ...addition,
    aliases: { ...base?.aliases, ...addition.aliases },
    skipColumns: { ...base?.skipColumns, ...addition.skipColumns },
    columnGates: { ...base?.columnGates, ...addition.columnGates },
    columnUnits: { ...base?.columnUnits, ...addition.columnUnits },
    descriptions: { ...base?.descriptions, ...addition.descriptions },
    reAdmit: { ...base?.reAdmit, ...addition.reAdmit },
  };
}

/** Every override file's maps, merged model-by-model into the single map the derivation reads. */
function mergePostgresOverrides(
  maps: readonly Readonly<Record<string, PostgresDatasetOverride>>[],
): Record<string, PostgresDatasetOverride> {
  const merged: Record<string, PostgresDatasetOverride> = {};
  for (const map of maps) {
    for (const [model, override] of Object.entries(map)) {
      merged[model] = mergePostgresOverride(merged[model], override);
    }
  }
  return merged;
}

export const LWQL_POSTGRES_ALL_OVERRIDES: Record<string, PostgresDatasetOverride> =
  mergePostgresOverrides([
    CORE_POSTGRES_OVERRIDES,
    TOPICS_POSTGRES_OVERRIDES,
    PARENTS_POSTGRES_OVERRIDES,
    CONTENT_POSTGRES_OVERRIDES,
    SENSITIVE_POSTGRES_OVERRIDES,
    VISIBILITY_POSTGRES_OVERRIDES,
    DESCRIPTIONS_POSTGRES_OVERRIDES,
  ]);

/** Plain codepoint order, identical in every locale. */
function byCodepoint(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

/**
 * Every tenant-scoped Prisma model that is not skipped, as a PostgreSQL-resident
 * view — ordered by exposed view name so the merge into `LWQL_VIEW_CATALOG` (and
 * the manifest lists it feeds) is deterministic.
 */
export const LWQL_POSTGRES_CATALOG: readonly LangWatchQLViewDefinition[] = [
  ...derivePostgresCatalog({
    manifest: LWQL_PRISMA_MANIFEST,
    skip: LWQL_POSTGRES_SKIPPED_MODELS,
    overrides: LWQL_POSTGRES_ALL_OVERRIDES,
  }),
  // Locale-independent: `localeCompare` orders by the runtime's default locale,
  // which can vary the order of these ASCII identifiers across environments —
  // a plain codepoint comparison sorts the same everywhere.
].toSorted((a, b) => byCodepoint(a.name, b.name));
