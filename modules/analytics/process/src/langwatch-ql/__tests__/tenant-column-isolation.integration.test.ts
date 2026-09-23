/**
 * Isolation proof for a source whose project column is not `TenantId`: a policy
 * on the wrong column polices nothing, so the shipped generators run over a
 * scratch `project_id`-keyed table, with the detached policy as the control.
 * @see specs/lwql/api.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLAccessModelService } from "../../services/langwatch-ql-access-model.service.ts";
import type { LangWatchQLViewDefinition } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLViewProvisioningService } from "../../services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../services/langwatch-ql-view-statements.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  selectRows,
  selectScalar,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

const accessModel = LangWatchQLAccessModelService.create();
const viewProvisioning = LangWatchQLViewProvisioningService.create();

/** A view over a source whose project column is `project_id`, not `TenantId`. */
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

describe("given a LangWatchQL view over a project_id-keyed source table", () => {
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
      ...viewProvisioning.setupStatements({
        names: harness.names,
        sourceDatabase: database,
        views: [PROJECT_ID_VIEW],
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    ]);

    await harness.admin.insert({
      table: `${database}.scratch_objects`,
      format: "JSONEachRow",
      values: [harness.tenantA, harness.tenantB].map((tenant) => ({
        project_id: tenant.tenantId,
        ObjectId: `${tenant.tenantId}-object`,
      })),
    });

    tenantA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the restricted identity carries project A's key context", () => {
    /** @scenario "Restricted identity with a valid key context reads only its own tenant's rows" */
    it("reads only project A's rows through the view", async () => {
      // An absence check passes against an empty table, so prove the other row exists first.
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
      expect(
        rows.every((row) => row.TenantId === harness.tenantA.tenantId),
        "view returned another project's rows",
      ).toBe(true);
    });

    /** @scenario "Detaching the row policy makes the other tenant's rows visible" */
    it("exposes project B's row once the policy is detached, and hides it again", async () => {
      await harness.applyAsAdmin([
        accessModel.dropRowPolicyStatement({
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
          accessModel.rowPolicyStatement({
            names: harness.names,
            lwqlTable: { table: "scratch_objects", tenantColumn: "project_id", database },
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
