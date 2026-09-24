/** Every catalogued view is readable by the restricted identity the access model provisions. */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLViewProvisioningService } from "../../services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../services/langwatch-ql-view-statements.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  mapPostgresIntoClickHouse,
  selectRows,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "./lwql-clickhouse-harness.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();
const viewProvisioning = LangWatchQLViewProvisioningService.create();

describe("given the whole LangWatchQL catalog provisioned over the shipped fact tables", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  /** The restricted identity carrying tenant-a's valid key-hash context. */
  let tenantA: ClickHouseClient;
  let database: string;

  beforeAll(async () => {
    // The catalog spans both residences, and the PostgreSQL-resident views
    // cannot be created until the engine tables they read exist. Stood up before
    // the views for that reason, as `catalogStatements.integration.test.ts` does.
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({
      suite: "every-view-readable",
      // The shipped migrations, so every fact table the catalog reads exists.
      facts: "migrated",
    });
    database = harness.names.database;
    // Maps the approved PostgreSQL views in as engine tables under the
    // LangWatchQL database, so the PostgreSQL-resident views resolve — a broken
    // named collection or a missing grant surfaces on the read below, per view.
    await mapPostgresIntoClickHouse({ harness, postgres });
    // Structural view objects, then the whole access model (grants, row
    // policies) rendered from the one shared definition (#8258).
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names: harness.names,
        sourceDatabase: harness.factDatabase,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
    await harness.applyAccessModel({
      views: LWQL_VIEW_CATALOG,
      sourceDatabase: harness.factDatabase,
    });
    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when the restricted identity reads every catalog view", () => {
    /**
     * One read per view, projecting every column (`SELECT *` expands to the
     * view's whole column list), so a projection that needs an ungranted source
     * column — or a PostgreSQL-resident view whose collection cannot dial Postgres
     */
    it("returns without error for every view, both residences", async () => {
      // The iteration must not be vacuous: an empty or truncated catalog would
      // make "every view read" trivially true.
      expect(
        LWQL_VIEW_CATALOG.length,
        "the catalog is unexpectedly small — this proof would certify almost nothing",
      ).toBeGreaterThan(100);

      let clickhouseResidentRead = 0;
      let postgresResidentRead = 0;
      const failures: string[] = [];

      for (const view of LWQL_VIEW_CATALOG) {
        try {
          await selectRows(tenantA, `SELECT * FROM ${database}.${view.name} LIMIT 1`);
          if (catalogShapes.isPostgresResident(view)) postgresResidentRead += 1;
          else clickhouseResidentRead += 1;
        } catch (error) {
          failures.push(
            `${view.name} (${catalogShapes.isPostgresResident(view) ? "postgres" : "clickhouse"}-resident): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      expect(
        failures,
        `views the restricted identity could not read:\n${failures.join("\n")}`,
      ).toEqual([]);

      // Both residences were actually exercised, so a run that read only the
      // ClickHouse half (a PostgreSQL mapping that silently produced nothing)
      // cannot pass as full coverage.
      expect(
        postgresResidentRead,
        "no PostgreSQL-resident view was read — the mapping or collection did not stand up",
      ).toBeGreaterThan(0);
      expect(clickhouseResidentRead, "no ClickHouse-resident view was read").toBeGreaterThan(0);
      // Every view was accounted for: read count equals catalog size.
      expect(clickhouseResidentRead + postgresResidentRead).toBe(LWQL_VIEW_CATALOG.length);
    });
  });
});
