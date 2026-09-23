/**
 * Isolation proof for a two-source catalog view (#8085): the tenant row policy bounds BOTH
 * physical tables, and detaching the joined side's policy is shown to leak.
 * @see specs/lwql/api.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_SOURCE_ALIAS } from "../../rules/lwql-source-alias.rules.ts";
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

/** A view over `join_left` ⋈ `join_right` on `Key`, exposing both sides' tenant. */
const JOIN_VIEW: LangWatchQLViewDefinition = {
  name: "join_probe",
  sourceTable: "join_left",
  description: "probe: a left table joined to a right table",
  gates: [],
  grain: "one matched pair",
  grainColumns: ["TenantId", "Key"],
  joinKeys: [],
  timeColumn: "OccurredAt",
  freshness: "test",
  dedup: { keyColumns: ["TenantId", "Key"], strategy: "none" },
  join: {
    table: "join_right",
    alias: "jr",
    kind: "INNER",
    on: `${LWQL_SOURCE_ALIAS}.\`Key\` = jr.\`Key\``,
    onSourceColumns: { primary: ["Key"], joined: ["Key"] },
    sourceColumns: ["TenantId", "Key", "RightVal"],
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "tenant of the left row",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    { name: "Key", type: "String", description: "join key", gates: [], sourceColumns: ["Key"] },
    {
      name: "LeftVal",
      type: "String",
      description: "value from the left table",
      gates: [],
      sourceColumns: ["LeftVal"],
    },
    {
      name: "RightTenant",
      type: "String",
      description: "tenant of the joined (right) row",
      gates: [],
      sourceColumns: [],
      expression: (_source, joined) => (joined ? joined("TenantId") : "NULL"),
    },
    {
      name: "RightVal",
      type: "String",
      description: "value from the joined (right) table",
      gates: [],
      sourceColumns: [],
      expression: (_source, joined) => (joined ? joined("RightVal") : "NULL"),
    },
  ],
};

interface JoinRow {
  TenantId: string;
  RightTenant: string;
}

describe("given a catalog view that joins two tenant-policed tables (#8085)", () => {
  let harness: LangWatchQLClickHouseHarness;
  let tenantA: ClickHouseClient;
  let database: string;
  let facts: string;

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "joinprobe" });
    database = harness.names.database;
    facts = harness.factDatabase;

    // Deliberately not among the harness's fixtures: their policies must come from the setup
    // statements under test.
    await harness.applyAsAdmin([
      `CREATE OR REPLACE TABLE ${facts}.join_left ` +
        `(TenantId String, Key String, LeftVal String) ENGINE = MergeTree ORDER BY (TenantId, Key)`,
      `CREATE OR REPLACE TABLE ${facts}.join_right ` +
        `(TenantId String, Key String, RightVal String) ENGINE = MergeTree ORDER BY (TenantId, Key)`,
    ]);

    // Shared keys on both sides plus a one-sided key each, so the INNER join returns exactly
    // the two matched pairs.
    const tenants = [harness.tenantA, harness.tenantB];
    await harness.admin.insert({
      table: `${facts}.join_left`,
      format: "JSONEachRow",
      values: tenants.flatMap((tenant) =>
        ["k1", "k2", "leftonly"].map((key) => ({
          TenantId: tenant.tenantId,
          Key: key,
          LeftVal: `${tenant.tenantId}-${key}-left`,
        })),
      ),
    });
    await harness.admin.insert({
      table: `${facts}.join_right`,
      format: "JSONEachRow",
      values: tenants.flatMap((tenant) =>
        ["k1", "k2", "rightonly"].map((key) => ({
          TenantId: tenant.tenantId,
          Key: key,
          RightVal: `${tenant.tenantId}-${key}-right`,
        })),
      ),
    });

    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names: harness.names,
        sourceDatabase: facts,
        views: [JOIN_VIEW],
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );

    tenantA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the restricted identity reads the joined view", () => {
    it("returns only its own tenant on both sides of the join", async () => {
      const rows = await selectRows<JoinRow>(
        tenantA,
        `SELECT TenantId, RightTenant FROM ${database}.join_probe ORDER BY Key`,
      );

      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.TenantId))).toEqual(new Set([harness.tenantA.tenantId]));
      expect(
        new Set(rows.map((row) => row.RightTenant)),
        "the joined side leaked another tenant",
      ).toEqual(new Set([harness.tenantA.tenantId]));
    });
  });

  describe("when the joined side's row policy is detached", () => {
    it("leaks the other tenant through the join, and hides it again once restored", async () => {
      const foreignRight = await selectScalar<string>(
        harness.admin,
        `SELECT count() AS value FROM ${facts}.join_right ` +
          `WHERE TenantId = '${harness.tenantB.tenantId}'`,
      );
      expect(Number(foreignRight)).toBeGreaterThan(0);

      let leakedTenants: string[] = [];
      try {
        await harness.applyAsAdmin([
          accessModel.dropRowPolicyStatement({
            names: harness.names,
            table: "join_right",
            database: facts,
          }),
        ]);
        const rows = await selectRows<JoinRow>(
          tenantA,
          `SELECT DISTINCT RightTenant FROM ${database}.join_probe ORDER BY RightTenant`,
        );
        leakedTenants = rows.map((row) => row.RightTenant);
      } finally {
        await harness.applyAsAdmin([
          accessModel.rowPolicyStatement({
            names: harness.names,
            lwqlTable: { table: "join_right", tenantColumn: "TenantId", database: facts },
          }),
        ]);
      }

      expect(
        leakedTenants,
        "detaching the joined side's policy changed nothing — it was not what bounds that side",
      ).toEqual([harness.tenantA.tenantId, harness.tenantB.tenantId]);

      const restored = await selectRows<JoinRow>(
        tenantA,
        `SELECT DISTINCT RightTenant FROM ${database}.join_probe`,
      );
      expect(
        restored.map((row) => row.RightTenant),
        "the joined side's policy was not restored, later reads would stay unprotected",
      ).toEqual([harness.tenantA.tenantId]);
    });
  });

  describe("when the key-hash context matches no project", () => {
    it("returns zero rows from the joined view, never an error", async () => {
      const noProject = await harness.restrictedClient({ keyHash: "not-a-real-key-hash" });

      expect(await selectRows(noProject, `SELECT Key FROM ${database}.join_probe`)).toHaveLength(0);
    });
  });
});
