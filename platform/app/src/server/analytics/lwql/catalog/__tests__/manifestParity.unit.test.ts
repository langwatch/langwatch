/**
 * The Go renderer's LWQL manifest must agree with this repo's catalog.
 *
 * `infra/clickhouse-serverless/internal/render/lwql_catalog.json` is the single
 * source of truth for the Go side of the LangWatchQL access model: it lists the
 * source tables the restricted identity is granted a filtered read of, and the
 * caller-facing views it is granted SELECT on. The Go binary embeds it, so what
 * Go renders is exactly this file — but nothing in the Go repo can tell whether
 * the file still matches the application's catalog, which is what actually
 * defines those tables and views. That gap is what let `batch_evaluations`
 * drift: it was in the Go lists and the SaaS renderer but absent from the
 * catalog.
 *
 * This test closes it. It derives both sets from the catalog and asserts the
 * manifest equals them, so a catalog change without a matching manifest edit
 * fails here. The langwatch-saas `render-config.sh` is a third list in another
 * repo and cannot be reached from single-repo CI — a real boundary, left to the
 * PR thread.
 *
 * @see ../../../../../../../../infra/clickhouse-serverless/internal/render/lwql.go
 * @see ../lwqlViews.ts — the catalog the manifest mirrors
 * @see ../../provisioning/catalogStatements.ts — lwqlSourceTables, the canonical source-table derivation
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { LangWatchQLNames } from "../../provisioning/accessModel";
import { lwqlSourceTables } from "../../provisioning/catalogStatements";
import { LWQL_VIEW_CATALOG } from "../lwqlViews";

const MANIFEST_PATH = fileURLToPath(
  new URL(
    "../../../../../../../../infra/clickhouse-serverless/internal/render/lwql_catalog.json",
    import.meta.url,
  ),
);

/** Only the fields the source-table derivation reads; the rest are irrelevant. */
const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "lwql_restricted",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

function manifest(): {
  sourceTables: string[];
  viewNames: string[];
  tenantColumns?: Record<string, string>;
} {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

/** The catalog's caller-facing view names in order. */
function catalogViewNames(): string[] {
  return LWQL_VIEW_CATALOG.map((view) => view.name);
}

/**
 * The catalog's distinct source tables in order, via the same helper the
 * provisioner uses — a single deployment database, so its qualified-name
 * dedup collapses to the bare names the Go manifest lists. The order is
 * load-bearing: the Go renderer iterates the array to generate GRANT
 * statements, and their order affects the rendered output.
 */
function catalogSourceTables(): string[] {
  return lwqlSourceTables({ names: NAMES, sourceDatabase: NAMES.database }).map(
    (table) => table.table,
  );
}

/**
 * The catalog's non-default tenant columns, keyed by source table — the same
 * sparse map the Go manifest carries. Derived from the identical helper the
 * provisioner uses, so the row filter the Go renderer applies to a source and
 * the row policy the app self-provisions on it name the same column. A source
 * on the default `TenantId` contributes nothing, matching a manifest that omits
 * it entirely.
 */
function catalogTenantColumns(): Record<string, string> {
  const entries = lwqlSourceTables({
    names: NAMES,
    sourceDatabase: NAMES.database,
  })
    .filter((table) => table.tenantColumn !== "TenantId")
    .map((table) => [table.table, table.tenantColumn] as const);
  return Object.fromEntries(entries);
}

describe("given the Go LWQL manifest and the application catalog", () => {
  const { sourceTables, viewNames, tenantColumns } = manifest();

  describe("when comparing view names", () => {
    it("the manifest's view names equal the catalog's in the same order", () => {
      const catalogNames = catalogViewNames();
      expect(viewNames).toEqual(catalogNames);
    });
  });

  describe("when comparing source tables", () => {
    it("the manifest's source tables equal the catalog's in the same order", () => {
      const catalogTables = catalogSourceTables();
      expect(sourceTables).toEqual(catalogTables);
    });
  });

  describe("when comparing tenant columns", () => {
    it("the manifest's tenant-column overrides equal the catalog's", () => {
      // Absent map is the backwards-compatible default: every source on
      // `TenantId` and nothing to override, so `{}` and an omitted field are
      // the same claim.
      expect(tenantColumns ?? {}).toEqual(catalogTenantColumns());
    });
  });
});
