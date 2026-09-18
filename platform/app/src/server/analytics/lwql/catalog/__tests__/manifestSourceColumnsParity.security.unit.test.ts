/**
 * The Go renderer's per-table grant columns must equal the app's column-scoped
 * grants (#8085 security finding 1: HIGH).
 *
 * Before this map the Go chart renderer granted the SaaS reader role
 * `GRANT SELECT ON db.table` — every column — for every source table, while the
 * self-hosted path (`catalogStatements.ts` `lwqlSourceColumnGrantStatement`)
 * grants only the columns the catalog exposes. The manifest's `sourceColumns`
 * map closes that gap: the Go binary embeds it and renders
 * `GRANT SELECT(col, …)` from it, so both paths grant exactly the exposed
 * surface.
 *
 * This test is what keeps the two in step: it derives the map from the same
 * helper the app's grants use and asserts the manifest equals it, so a catalog
 * change without a matching manifest edit fails here rather than silently
 * re-widening the SaaS grant. The langwatch-saas `render-config.sh` is a third
 * list in another repo (it renders its own whole-table grants and does not
 * consume the Go output) and cannot be reached from single-repo CI.
 *
 * @see ../../../../../../../../infra/clickhouse-serverless/internal/render/lwql.go
 * @see ../../provisioning/catalogStatements.ts — lwqlSourceColumnGrants, the canonical derivation
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { lwqlSourceColumnGrants } from "../../provisioning/catalogStatements";

const MANIFEST_PATH = fileURLToPath(
  new URL(
    "../../../../../../../../infra/clickhouse-serverless/internal/render/lwql_catalog.json",
    import.meta.url,
  ),
);

function manifest(): { sourceColumns?: Record<string, string[]> } {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("given the Go LWQL manifest and the application catalog", () => {
  describe("when comparing per-table grant columns", () => {
    it("the manifest's sourceColumns map equals the catalog's column-scoped grants", () => {
      const { sourceColumns } = manifest();
      expect(sourceColumns ?? {}).toEqual(lwqlSourceColumnGrants());
    });

    it("omits the PostgreSQL-engine bridge tables, which take a whole-object grant", () => {
      const { sourceColumns } = manifest();
      const pgTables = Object.keys(sourceColumns ?? {}).filter((table) =>
        table.endsWith("_pg"),
      );
      expect(pgTables).toEqual([]);
    });

    it("column-scopes a fact table down to its exposed columns, tenant column included", () => {
      const grants = lwqlSourceColumnGrants();
      // stored_objects is the project_id-keyed source: its tenant column must be
      // in the granted set, and the grant must not be the whole table.
      expect(grants.stored_objects).toContain("project_id");
      expect(grants.trace_summaries).toContain("TenantId");
    });
  });
});
