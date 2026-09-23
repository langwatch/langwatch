/**
 * Isolation proof for a two-source catalog view (#8085 / #8116 Part B, step 3).
 *
 * Runs the *shipped* provisioning (`lwqlViewSetupStatements`) for a synthetic
 * view that joins two fact tables, against a real ClickHouse 25.10 server as the
 * actual restricted identity — the same bar as `tenantIsolation.integration.test.ts`.
 * The point is the property the join extension has to hold: the tenant row
 * policy applies to BOTH physical tables, so a join cannot reach the joined side
 * unscoped.
 *
 * Two habits carried from the sibling suite:
 *  - every "no foreign rows" claim is paired with an admin-side count proving
 *    the rows it failed to return exist, so an absence check cannot pass against
 *    an empty table;
 *  - the joined side's policy is proved load-bearing by detaching it and showing
 *    the other tenant's rows leak through the join, then restoring it.
 *
 * @see specs/lwql/api.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LangWatchQLViewDefinition } from "../catalog/types";
import { dropLangWatchQLRowPolicyStatement } from "../provisioning/accessModel";
import {
  LWQL_SOURCE_ALIAS,
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
    {
      name: "Key",
      type: "String",
      description: "join key",
      gates: [],
      sourceColumns: ["Key"],
    },
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
      expression: (_source, joined) => joined!("TenantId"),
    },
    {
      name: "RightVal",
      type: "String",
      description: "value from the joined (right) table",
      gates: [],
      sourceColumns: [],
      expression: (_source, joined) => joined!("RightVal"),
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

    // Two toy fact tables in the fact database, deliberately not among the
    // harness's pre-policed fixtures — their policies must come from the setup
    // statements under test, not from the harness.
    await harness.applyAsAdmin([
      `CREATE OR REPLACE TABLE ${facts}.join_left ` +
        `(TenantId String, Key String, LeftVal String) ENGINE = MergeTree ORDER BY (TenantId, Key)`,
      `CREATE OR REPLACE TABLE ${facts}.join_right ` +
        `(TenantId String, Key String, RightVal String) ENGINE = MergeTree ORDER BY (TenantId, Key)`,
    ]);

    // Each tenant carries shared keys (k1, k2) on both sides, plus a key present
    // on only one side, so the INNER join returns exactly the two matched pairs
    // and neither the left-only nor the right-only key.
    const leftKeys = ["k1", "k2", "leftonly"];
    const rightKeys = ["k1", "k2", "rightonly"];
    await harness.admin.insert({
      table: `${facts}.join_left`,
      format: "JSONEachRow",
      values: [harness.tenantA, harness.tenantB].flatMap((tenant) =>
        leftKeys.map((key) => ({
          TenantId: tenant.tenantId,
          Key: key,
          LeftVal: `${tenant.tenantId}-${key}-left`,
        })),
      ),
    });
    await harness.admin.insert({
      table: `${facts}.join_right`,
      format: "JSONEachRow",
      values: [harness.tenantA, harness.tenantB].flatMap((tenant) =>
        rightKeys.map((key) => ({
          TenantId: tenant.tenantId,
          Key: key,
          RightVal: `${tenant.tenantId}-${key}-right`,
        })),
      ),
    });

    await harness.applyAsAdmin(
      lwqlViewSetupStatements({
        names: harness.names,
        sourceDatabase: facts,
        views: [JOIN_VIEW],
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );

    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
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

      // The two matched pairs (k1, k2) and nothing from the one-sided keys.
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.TenantId))).toEqual(
        new Set([harness.tenantA.tenantId]),
      );
      expect(
        new Set(rows.map((row) => row.RightTenant)),
        "the joined side leaked another tenant",
      ).toEqual(new Set([harness.tenantA.tenantId]));
    });
  });

  describe("when the joined side's row policy is detached", () => {
    it("leaks the other tenant through the join, and hides it again once restored", async () => {
      // Control: the other tenant really has right-side rows to leak.
      const foreignRight = await selectScalar<string>(
        harness.admin,
        `SELECT count() AS value FROM ${facts}.join_right ` +
          `WHERE TenantId = '${harness.tenantB.tenantId}'`,
      );
      expect(Number(foreignRight)).toBeGreaterThan(0);

      let leakedTenants: string[] = [];
      try {
        await harness.applyAsAdmin([
          dropLangWatchQLRowPolicyStatement({
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
          lwqlHarnessRowPolicyStatement({
            names: harness.names,
            table: "join_right",
            tenantColumn: "TenantId",
            sourceDatabase: facts,
          }),
        ]);
      }

      // Without the joined-side policy the join reaches the other tenant's rows.
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
      const noProject = await harness.restrictedClient({
        keyHash: "not-a-real-key-hash",
      });
      const rows = await selectRows(
        noProject,
        `SELECT Key FROM ${database}.join_probe`,
      );
      expect(rows).toHaveLength(0);
    });
  });
});
