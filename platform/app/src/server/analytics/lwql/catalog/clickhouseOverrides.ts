/**
 * Every ClickHouse domain override, merged into the single map the explicit
 * catalog reads.
 *
 * A {@link defineCatalogTable} entry in `./lwqlViews.ts` looks its table's
 * refinements up here — a caller-facing name, a lifted gate, a renamed column —
 * before the safe defaults are applied. This is only the per-table refinement
 * data; whether a table is in the catalog at all is decided by whether
 * `LWQL_VIEW_CATALOG` names it, never by presence in this map.
 *
 * @see ./defineDatasetFromTable.ts — the builder these refine
 * @see ./lwqlViews.ts — the explicit catalog that lists every table
 * @see ./overrides — the per-domain refinement files merged here
 */

import type { DatasetOverride } from "./defineDatasetFromTable";
import { AUDIT_OVERRIDES } from "./overrides/audit";
import { CODING_OVERRIDES } from "./overrides/coding";
import { EXPERIMENTS_OVERRIDES } from "./overrides/experiments";
import { GATEWAY_OVERRIDES } from "./overrides/gateway";
import { GOVERNANCE_OVERRIDES } from "./overrides/governance";
import { LANGY_OVERRIDES } from "./overrides/langy";
import { LEGACY_OVERRIDES } from "./overrides/legacy";
import { METRICS_OVERRIDES } from "./overrides/metrics";
import { OBSERVABILITY_OVERRIDES } from "./overrides/observability";

/** Every domain override, merged into the single map the catalog reads. */
export const CLICKHOUSE_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
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
