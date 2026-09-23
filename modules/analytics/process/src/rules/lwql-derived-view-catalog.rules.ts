/** The full derived half of the LangWatchQL catalog. */

import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service.ts";
import { AUDIT_OVERRIDES } from "./lwql-audit-overrides.rules.ts";
import { CODING_OVERRIDES } from "./lwql-coding-overrides.rules.ts";
import { LWQL_COLUMNS_MANIFEST } from "./lwql-columns-manifest.rules.ts";
import { type DatasetOverride, deriveDefaultCatalog } from "./lwql-dataset-derivation.rules.ts";
import { EXPERIMENTS_OVERRIDES } from "./lwql-experiments-overrides.rules.ts";
import { GATEWAY_OVERRIDES } from "./lwql-gateway-overrides.rules.ts";
import { GOVERNANCE_OVERRIDES } from "./lwql-governance-overrides.rules.ts";
import { LANGY_OVERRIDES } from "./lwql-langy-overrides.rules.ts";
import { LEGACY_OVERRIDES } from "./lwql-legacy-overrides.rules.ts";
import { METRICS_OVERRIDES } from "./lwql-metrics-overrides.rules.ts";
import { OBSERVABILITY_OVERRIDES } from "./lwql-observability-overrides.rules.ts";
import { LWQL_CATALOG_SKIPPED_TABLES } from "./lwql-skipped-tables.rules.ts";

/** Source tables already carried by a hand-authored view in `./lwqlViews.ts`. */
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
  "instant_eval_judgments",
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
 * Every manifest table neither hand-written nor skipped, as a view — ordered by exposed view name
 * so the merge into `LWQL_VIEW_CATALOG` (and the manifest lists it feeds) is deterministic
 * regardless of physical table name or override iteration order.
 */
export const LWQL_DERIVED_CATALOG: readonly LangWatchQLViewDefinition[] = [
  ...deriveDefaultCatalog({
    manifest: LWQL_COLUMNS_MANIFEST,
    skip: LWQL_CATALOG_SKIPPED_TABLES,
    handWritten: LWQL_HAND_WRITTEN_SOURCE_TABLES,
    overrides: LWQL_ALL_OVERRIDES,
  }),
].toSorted((a, b) => a.name.localeCompare(b.name));
