/**
 * The Go renderer's LWQL manifest must agree with this repo's catalog — Go
 * embeds a static JSON copy nothing in that repo can validate. This test
 * derives both sets from the catalog so a drift (`batch_evaluations` did) fails here.
 * @see ../../../../../../infra/clickhouse-serverless/internal/render/lwql.go
 * @see ../lwql-view-catalog.rules.ts — the catalog the manifest mirrors
 * @see ../../services/langwatch-ql-view-provisioning.service.ts — source-table derivation
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { LangWatchQLNames } from "../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLViewProvisioningService } from "../../services/langwatch-ql-view-provisioning.service.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

const MANIFEST_PATH = fileURLToPath(
  new URL(
    "../../../../../../infra/clickhouse-serverless/internal/render/lwql_catalog.json",
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

function manifest(): { sourceTables: string[]; viewNames: string[] } {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

/** The catalog's caller-facing view names in order. */
function catalogViewNames(): string[] {
  return LWQL_VIEW_CATALOG.map((view) => view.name);
}

/**
 * The catalog's distinct source tables, in order — via the same helper the
 * provisioner uses. Order is load-bearing: the Go renderer iterates this
 * array to generate GRANT statements, and their order affects the output.
 */
function catalogSourceTables(): string[] {
  return viewProvisioning
    .sourceTables({ names: NAMES, sourceDatabase: NAMES.database })
    .map((table) => table.table);
}

describe("given the Go LWQL manifest and the application catalog", () => {
  const { sourceTables, viewNames } = manifest();

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
});
