/**
 * Isolation proof for a source whose project column is not `TenantId`.
 *
 * Almost every fact table names the owning project `TenantId`, and the whole
 * isolation suite reads against those. One source spells it differently —
 * `stored_objects` carries `project_id` (migration 00023) — and its row policy
 * has to filter *that* column. A policy on the wrong column is not a syntax
 * error: it silently polices nothing and hands the restricted identity every
 * tenant's rows.
 *
 * This provisions the *shipped* generators over a scratch `project_id`-keyed
 * table on a real ClickHouse 25.10 server and proves a key for one project reads
 * only that project's rows through the view — and, as the negative control, that
 * detaching the policy makes the other project's rows visible, so the assertion
 * is testing the policy rather than an empty table.
 *
 * @see ../provisioning/catalogStatements.ts — lwqlSourceTables, which resolves the column
 * @see specs/lwql/api.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LangWatchQLViewDefinition } from "../catalog/types";
import { dropLangWatchQLRowPolicyStatement } from "../provisioning/accessModel";
import {
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "../provisioning/catalogStatements";
import {
  type LangWatchQLClickHouseHarness,
  lwqlHarnessRowPolicyStatement,
  selectRows,
  selectScalar,
  startLangWatchQLClickHouse,
} from "./lwqlClickHouseHarness";

/** A dataset over a source whose project column is `project_id`, not `TenantId`. */
const PROJECT_ID_VIEW: LangWatchQLViewDefinition = {
  name: "scratch_objects_dataset",
  sourceTable: "scratch_objects",
  description: "Scratch project_id-keyed dataset for the tenant-column proof.",
  gates: [],
  grain: "one row per (project_id, ObjectId)",
  grainColumns: ["TenantId", "ObjectId"],
  joinKeys: ["TenantId"],
  timeColumn: "ObjectId",
  freshness: "seconds",
  tenantColumn: "project_id",
  dedup: { strategy: "none", keyColumns: ["TenantId", "ObjectId"] },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Owning project, read from the physical project_id column.",
      gates: [],
      sourceColumns: ["project_id"],
    },
    {
      name: "ObjectId",
      type: "String",
      description: "Stored object id.",
      gates: [],
      sourceColumns: ["ObjectId"],
    },
  ],
};

describe("given a LangWatchQL dataset over a project_id-keyed source table", () => {
  let harness: LangWatchQLClickHouseHarness;
  let tenantA: ClickHouseClient;
  let database: string;

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "tenant_column" });
    database = harness.names.database;

    await harness.applyAsAdmin([
      `CREATE TABLE ${database}.scratch_objects ` +
        "(project_id String, ObjectId String) " +
        "ENGINE = MergeTree ORDER BY (project_id, ObjectId)",
      ...lwqlViewSetupStatements({
        names: harness.names,
        sourceDatabase: database,
        views: [PROJECT_ID_VIEW],
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    ]);

    // One row per project, keyed by project_id = the tenant id the key map
    // resolves each key hash to.
    await harness.admin.insert({
      table: `${database}.scratch_objects`,
      format: "JSONEachRow",
      values: [harness.tenantA, harness.tenantB].map((tenant) => ({
        project_id: tenant.tenantId,
        ObjectId: `${tenant.tenantId}-object`,
      })),
    });

    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the restricted identity carries project A's key context", () => {
    /** @scenario "Restricted identity with a valid key context reads only its own tenant's rows" */
    it("reads only project A's rows through the view", async () => {
      // The rows it must NOT see exist: an absence check passes against an empty
      // table, so prove the other project's row is really there first.
      const otherRows = await selectScalar<string>(
        harness.admin,
        `SELECT toString(count()) AS value FROM ${database}.scratch_objects ` +
          `WHERE project_id = '${harness.tenantB.tenantId}'`,
      );
      expect(Number(otherRows)).toBe(1);

      const rows = await selectRows<{ TenantId: string; ObjectId: string }>(
        tenantA,
        `SELECT TenantId, ObjectId FROM ${database}.scratch_objects_dataset ORDER BY ObjectId`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.TenantId).toBe(harness.tenantA.tenantId);
      expect(
        rows.every((row) => row.TenantId === harness.tenantA.tenantId),
        "view returned another project's rows",
      ).toBe(true);
    });

    /**
     * The negative control: if detaching the policy on `scratch_objects` does
     * not change the result, the read above was not being policed. Restores in a
     * `finally` so a failure cannot leave the source unpoliced.
     */
    /** @scenario "Detaching the row policy makes the other tenant's rows visible" */
    it("exposes project B's row once the policy is detached, and hides it again", async () => {
      const lwqlTable = {
        table: "scratch_objects",
        tenantColumn: "project_id",
        database,
      };
      await harness.applyAsAdmin([
        dropLangWatchQLRowPolicyStatement({
          names: harness.names,
          table: "scratch_objects",
          database,
        }),
      ]);
      try {
        const unpoliced = await selectRows<{ TenantId: string }>(
          tenantA,
          `SELECT TenantId FROM ${database}.scratch_objects_dataset`,
        );
        expect(unpoliced.length).toBe(2);
      } finally {
        await harness.applyAsAdmin([
          lwqlHarnessRowPolicyStatement({
            names: harness.names,
            table: lwqlTable.table,
            tenantColumn: lwqlTable.tenantColumn,
            sourceDatabase: database,
          }),
        ]);
      }

      const repoliced = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT TenantId FROM ${database}.scratch_objects_dataset`,
      );
      expect(repoliced.length).toBe(1);
    });
  });
});
