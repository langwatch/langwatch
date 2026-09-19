/**
 * LangWatchQL analytics SQL — the PostgreSQL-resident half of the catalog,
 * assembled from the derivation.
 *
 * ## Why opt-out
 *
 * This file used to hand-write five-then-six views and explain "why these and
 * no others". That is no longer the contract. The Postgres half now mirrors the
 * ClickHouse half (`derivedViews.ts`): every tenant-scoped Prisma model becomes
 * a view *by default*, and a model stays off only by being on
 * {@link ./postgresSkippedModels#LWQL_POSTGRES_SKIPPED_MODELS} with a reason.
 * A new table that carries an owning project is therefore catalogued and
 * content-gated automatically, rather than silently staying off until someone
 * remembers to add it — and `tenantModelCoverage.unit.test.ts` fails until
 * every model is either derived or skipped-with-a-reason.
 *
 * This module is the single assembly point: it feeds the manifest, the skip map
 * and every override file to {@link derivePostgresCatalog} and exports the
 * result. `lwqlViews.ts` imports {@link LWQL_POSTGRES_CATALOG} unchanged to
 * spread into `LWQL_VIEW_CATALOG`; the six formerly-hand-written views are now
 * overrides in `./postgresOverrides/core.ts`.
 *
 * @see ./derivePostgresCatalog.ts — the derivation and its overrides
 * @see ./postgresSkippedModels.ts — what is deliberately left off, and why
 * @see ./postgresOverrides — per-model refinements to the safe defaults
 * @see specs/lwql/postgres-catalog.feature
 */

import {
  derivePostgresCatalog,
  type PostgresDatasetOverride,
} from "./derivePostgresCatalog";
import { CONTENT_POSTGRES_OVERRIDES } from "./postgresOverrides/content";
import { CORE_POSTGRES_OVERRIDES } from "./postgresOverrides/core";
import { PARENTS_POSTGRES_OVERRIDES } from "./postgresOverrides/parents";
import { SENSITIVE_POSTGRES_OVERRIDES } from "./postgresOverrides/sensitive";
import { TOPICS_POSTGRES_OVERRIDES } from "./postgresOverrides/topics";
import { VISIBILITY_POSTGRES_OVERRIDES } from "./postgresOverrides/visibility";
import { LWQL_POSTGRES_SKIPPED_MODELS } from "./postgresSkippedModels";
import { LWQL_PRISMA_MANIFEST } from "./prismaManifest";
import type { LangWatchQLViewDefinition } from "./types";

/**
 * Combines two override maps model-by-model, not key-by-key: a plain object
 * spread would let a later file's entry for a model silently replace an
 * earlier file's entry for that *same* model, dropping whichever record
 * fields (aliases, skipColumns, descriptions, ...) only the earlier one set.
 * `LangyConversationProjection` is exactly this case — `content.ts` gates its
 * `Title` column and `visibility.ts` restricts its rows, and both must hold.
 */
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

export const LWQL_POSTGRES_ALL_OVERRIDES: Record<
  string,
  PostgresDatasetOverride
> = mergePostgresOverrides([
  CORE_POSTGRES_OVERRIDES,
  TOPICS_POSTGRES_OVERRIDES,
  PARENTS_POSTGRES_OVERRIDES,
  CONTENT_POSTGRES_OVERRIDES,
  SENSITIVE_POSTGRES_OVERRIDES,
  VISIBILITY_POSTGRES_OVERRIDES,
]);

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
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
