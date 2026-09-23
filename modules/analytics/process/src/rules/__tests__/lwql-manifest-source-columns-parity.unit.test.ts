/**
 * The Go renderer's per-table grant columns must equal the app's column-scoped grants (#8085
 * security finding 1: HIGH).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../services/langwatch-ql-view-provisioning.service.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

const MANIFEST_PATH = fileURLToPath(
  new URL(
    "../../../../../../infra/clickhouse-serverless/internal/render/lwql_catalog.json",
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
      expect(sourceColumns ?? {}).toEqual(viewProvisioning.sourceColumnGrants({}));
    });

    it("omits the PostgreSQL-engine bridge tables, which take a whole-object grant", () => {
      const { sourceColumns } = manifest();
      const pgTables = Object.keys(sourceColumns ?? {}).filter((table) => table.endsWith("_pg"));
      expect(pgTables).toEqual([]);
    });

    it("column-scopes a fact table down to its exposed columns, tenant column included", () => {
      const grants = viewProvisioning.sourceColumnGrants({});
      // stored_objects is the project_id-keyed source: its tenant column must be
      // in the granted set, and the grant must not be the whole table.
      expect(grants.stored_objects).toContain("project_id");
      expect(grants.trace_summaries).toContain("TenantId");
    });
  });
});
