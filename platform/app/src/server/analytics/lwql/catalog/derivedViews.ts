/**
 * The full derived half of the LangWatchQL catalog: every ClickHouse table
 * that is neither hand-written (a `LangWatchQLViewDefinition` authored
 * directly in `./lwqlViews.ts`) nor skipped (`./skippedTables.ts`), turned
 * into a view by {@link deriveDefaultCatalog}, refined by every table's
 * override.
 *
 * This is the single place the manifest, the skip map and every domain
 * override file (`./overrides/*.ts`) are assembled — `lwqlViews.ts` imports
 * only {@link LWQL_DERIVED_CATALOG} to spread into `LWQL_VIEW_CATALOG`, and
 * `./__tests__/tenantTableCoverage.unit.test.ts` imports the same export
 * rather than re-deriving it, so the coverage guard and the shipped catalog
 * can never compute two different answers.
 *
 * @see ./defineDatasetFromTable.ts — the builder and its opt-out catalog
 * @see ./skippedTables.ts — what is deliberately left off
 * @see ./overrides — per-table refinements to the safe defaults
 */

import { LWQL_COLUMNS_MANIFEST } from "./columnsManifest";
import {
  type DatasetOverride,
  deriveDefaultCatalog,
} from "./defineDatasetFromTable";
import { AUDIT_OVERRIDES } from "./overrides/audit";
import { CODING_OVERRIDES } from "./overrides/coding";
import { EXPERIMENTS_OVERRIDES } from "./overrides/experiments";
import { GATEWAY_OVERRIDES } from "./overrides/gateway";
import { GOVERNANCE_OVERRIDES } from "./overrides/governance";
import { LANGY_OVERRIDES } from "./overrides/langy";
import { LEGACY_OVERRIDES } from "./overrides/legacy";
import { METRICS_OVERRIDES } from "./overrides/metrics";
import { OBSERVABILITY_OVERRIDES } from "./overrides/observability";
import { LWQL_CATALOG_SKIPPED_TABLES } from "./skippedTables";
import type { LangWatchQLViewDefinition } from "./types";

/**
 * Source tables already carried by a hand-authored view in `./lwqlViews.ts`.
 *
 * A literal, not a read of `LWQL_VIEW_CATALOG`: `lwqlViews.ts` imports
 * {@link LWQL_DERIVED_CATALOG} from this module to build that very array, so
 * importing it back here would be a real ESM cycle — this module would run
 * (as `lwqlViews.ts`'s own import) before `lwqlViews.ts` has assigned
 * anything, and the binding would be read before initialization.
 * `./__tests__/tenantTableCoverage.unit.test.ts` re-derives this
 * independently, from `LWQL_VIEW_CATALOG` filtered to entries not in
 * {@link LWQL_DERIVED_CATALOG}, so the two can never silently drift without a
 * failing test.
 */
export const LWQL_HAND_WRITTEN_SOURCE_TABLES = [
  "trace_summaries",
  "stored_spans",
  "evaluation_runs",
  "simulation_runs",
  "trace_analytics",
  "trace_analytics_rollup",
  "evaluation_analytics",
  "evaluation_analytics_rollup",
  "coding_agent_sessions",
  "coding_agent_session_events",
] as const;

/** Every domain override, merged into the single map `deriveDefaultCatalog` reads. */
export const LWQL_ALL_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  ...OBSERVABILITY_OVERRIDES,
  ...LANGY_OVERRIDES,
  ...CODING_OVERRIDES,
  ...EXPERIMENTS_OVERRIDES,
  ...METRICS_OVERRIDES,
  ...GATEWAY_OVERRIDES,
  ...AUDIT_OVERRIDES,
  ...LEGACY_OVERRIDES,
  ...GOVERNANCE_OVERRIDES,
};

/**
 * Every manifest table neither hand-written nor skipped, as a view —
 * ordered by exposed view name so the merge into `LWQL_VIEW_CATALOG` (and
 * the manifest lists it feeds) is deterministic regardless of physical table
 * name or override iteration order.
 */
export const LWQL_DERIVED_CATALOG: readonly LangWatchQLViewDefinition[] = [
  ...deriveDefaultCatalog({
    manifest: LWQL_COLUMNS_MANIFEST,
    skip: LWQL_CATALOG_SKIPPED_TABLES,
    handWritten: LWQL_HAND_WRITTEN_SOURCE_TABLES,
    overrides: LWQL_ALL_OVERRIDES,
  }),
].sort((a, b) => a.name.localeCompare(b.name));
