/**
 * Isolation proof, part 1: row-policy enforcement as the restricted identity.
 *
 * Every assertion here executes as the actual restricted database user against
 * a real ClickHouse 25.10 server carrying the shipped provisioning. Nothing is
 * satisfied by a validator, a mock, or a query builder — the feature file makes
 * that a hard bar, because a validator can only prove what the gateway refuses
 * to send, never what the database refuses to answer.
 *
 * Two habits run through the file, both answers to the way isolation tests
 * quietly go vacuous:
 *
 *  - Every "no foreign rows" and "zero rows" claim is paired with an
 *    administrator-side count proving the rows it failed to return exist. An
 *    absence check passes against an empty database.
 *  - Every rejection is asserted by specific error code. "It threw" is not a
 *    proof of containment when a typo throws too.
 *
 * @see specs/analytics/governed-sql-api.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditedSettingValue,
  definerViewAuditQuery,
  dropGovernedRowPolicyStatement,
  governedDictionaryAuditQuery,
  governedGrantStatement,
  governedPolicyCoverageQuery,
  governedRowPolicyStatement,
} from "../provisioning";
import {
  CLICKHOUSE_ERROR_CODE,
  expectClickHouseError,
  expectOnlyTenantA,
  expectRestrictedIdentity,
  expectTenantScopedRead,
  expectZeroRowsWithControl,
  type GovernedClickHouseHarness,
  recordSeedControl,
  runStatement,
  selectRows,
  selectScalar,
  startGovernedClickHouse,
} from "./governedClickHouseHarness";

describe("given the governed analytics setup applied to a ClickHouse 25.10 server", () => {
  let harness: GovernedClickHouseHarness;
  /** The restricted identity carrying tenant-a's valid key-hash context. */
  let tenantA: ClickHouseClient;
  let database: string;

  beforeAll(async () => {
    harness = await startGovernedClickHouse({ suite: "isolation" });
    database = harness.names.database;
    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the restricted identity carries a valid key-hash context", () => {
    /** @scenario "Restricted identity with a valid key context reads only its own tenant's rows" */
    it("reads its own tenant's rows and none of the other tenant's", async () => {
      await expectRestrictedIdentity({ client: tenantA, names: harness.names });
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{ TenantId: string; TraceId: string }>(
        tenantA,
        `SELECT TenantId, TraceId FROM ${database}.traces ORDER BY TraceId`,
      );

      expectOnlyTenantA({
        rows,
        tenantColumn: "TenantId",
        harness,
        context: "baseline scoped read",
      });
      // Containment is exact, not merely "a subset": the caller sees all of its
      // own rows, so the policy is scoping rather than swallowing.
      expect(rows).toHaveLength(control.tenantA);
    });

    /**
     * The negative control for the whole suite. If detaching the mechanism does
     * not change the result, none of the assertions above are testing it.
     *
     * Runs against `spans` rather than `traces` so a failure part-way through
     * cannot leave the table every other test reads unpoliced, and restores in
     * a `finally` either way.
     */
    /** @scenario "Restricted identity with a valid key context reads only its own tenant's rows" */
    /** @scenario "Detaching the row policy makes the other tenant's rows visible" */
    it("exposes the other tenant's rows once the row policy is detached, and hides them again once restored", async () => {
      const spans = harness.governedTables.find(
        (governedTable) => governedTable.table === "spans",
      )!;
      await recordSeedControl({
        harness,
        table: "spans",
        tenantColumn: "TenantId",
      });

      let tenantsWithoutPolicy: string[] = [];
      try {
        await harness.applyAsAdmin([
          dropGovernedRowPolicyStatement({
            names: harness.names,
            table: "spans",
          }),
        ]);
        const rows = await selectRows<{ TenantId: string }>(
          tenantA,
          `SELECT DISTINCT TenantId FROM ${database}.spans ORDER BY TenantId`,
        );
        tenantsWithoutPolicy = rows.map((row) => row.TenantId);
      } finally {
        await harness.applyAsAdmin([
          governedRowPolicyStatement({
            names: harness.names,
            governedTable: spans,
          }),
        ]);
      }

      expect(
        tenantsWithoutPolicy,
        "removing the row policy changed nothing — the policy is not what bounds the read",
      ).toEqual([harness.tenantA.tenantId, harness.tenantB.tenantId]);

      const restored = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.spans`,
      );
      expect(
        restored.map((row) => row.TenantId),
        "the row policy was not restored, later tests would run unprotected",
      ).toEqual([harness.tenantA.tenantId]);
    });
  });

  describe("when the key-hash context matches no key-map entry", () => {
    /** @scenario "Empty key context yields zero rows, never all rows" */
    it("returns zero rows for an empty context without erroring", async () => {
      await expectZeroRowsWithControl({
        harness,
        keyHash: "",
        table: "traces",
        tenantColumn: "TenantId",
        context: "empty key context",
      });
    });

    /** @scenario "Garbage key context yields zero rows, never all rows" */
    it("returns zero rows for a garbage context without erroring", async () => {
      await expectZeroRowsWithControl({
        harness,
        keyHash: "not-a-real-key-hash",
        table: "traces",
        tenantColumn: "TenantId",
        context: "garbage key context",
      });
    });

    /**
     * The third key state, and the one that makes the model fail closed: a
     * caller that sends no tenant setting at all. Nothing in the request path
     * has to remember to default it — the profile already did.
     */
    /** @scenario "A caller that sends no tenant context at all reads nothing" */
    it("returns zero rows when the caller sends no tenant setting at all", async () => {
      await expectZeroRowsWithControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
        context: "absent tenant setting",
      });

      const client = await harness.restrictedClient();
      const profileDefault = await selectScalar<string>(
        client,
        `SELECT getSetting('${harness.names.tenantSetting}') AS value`,
      );
      expect(
        profileDefault,
        "the profile default is what makes an absent context read nothing",
      ).toBe("");
    });
  });

  describe("when the query text overrides settings", () => {
    /** @scenario "Overriding the tenant setting in query text cannot reach another tenant's rows without that tenant's valid key hash" */
    it("reaches no foreign rows with a guessed tenant setting", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT TenantId FROM ${database}.traces ` +
          `SETTINGS ${harness.names.tenantSetting} = 'guessed-key-hash'`,
      );

      expect(
        rows,
        `a guessed key hash returned rows while ${control.tenantB} tenant-b rows exist`,
      ).toHaveLength(0);
    });

    /**
     * The documented capability boundary, asserted rather than hidden: the key
     * hash IS the credential, so a caller holding a victim's valid hash reads
     * the victim's rows. The issue's design says exactly this ("useless without
     * a victim's valid key"), and the gateway's AST validator rejecting any
     * SETTINGS clause is the defense-in-depth layer above it. A test that
     * quietly omitted this would misrepresent what the database layer promises.
     */
    /** @scenario "Overriding the tenant setting in query text cannot reach another tenant's rows without that tenant's valid key hash" */
    it("does reach the other tenant's rows when the override carries that tenant's real key hash", async () => {
      await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.traces ` +
          `SETTINGS ${harness.names.tenantSetting} = '${harness.tenantB.keyHash}'`,
      );

      expect(
        rows.map((row) => row.TenantId),
        "possession of a valid key hash is the security boundary at the database layer",
      ).toEqual([harness.tenantB.tenantId]);
    });

    /** @scenario "Overriding a pinned setting in query text is rejected by profile constraints" */
    it("rejects a pinned setting with a settings-constraint error", async () => {
      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT count() FROM ${database}.traces SETTINGS max_execution_time = 9999`,
          ),
        CLICKHOUSE_ERROR_CODE.READONLY,
        "overriding a pinned ceiling",
      );

      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT count() FROM ${database}.traces SETTINGS readonly = 0`,
          ),
        CLICKHOUSE_ERROR_CODE.READONLY,
        "unpinning readonly itself",
      );

      // Not in the profile at all. `readonly = 1` refuses every setting change
      // except the tenant capability, so the CONST pins are belt and braces
      // rather than the load-bearing control.
      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT count() FROM ${database}.traces SETTINGS max_threads = 64`,
          ),
        CLICKHOUSE_ERROR_CODE.READONLY,
        "changing a setting the profile never mentions",
      );

      await expectClickHouseError(
        runStatement(tenantA, "SET readonly = 0"),
        CLICKHOUSE_ERROR_CODE.READONLY,
        "unpinning readonly as a standalone statement",
      );
    });
  });

  describe("when the query nests the governed table in a compound shape", () => {
    /** @scenario "Row policy holds inside a CTE" */
    it("scopes reads reached through a WITH clause", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "traces",
        tenantColumn: "TenantId",
        context: "CTE",
        query:
          `WITH scoped AS (SELECT TenantId, TraceId FROM ${database}.traces) ` +
          `SELECT TenantId, TraceId FROM scoped ORDER BY TraceId`,
      });
    });

    /**
     * Shadowing the key map's name does not defeat the policy: the policy's
     * `USING` expression resolves against the real table, not the caller's
     * alias, so redefining the name in the query changes nothing.
     */
    /** @scenario "Shadowing or aliasing the key-map table name does not defeat the policy" */
    it("scopes reads when the query shadows the key-map table name", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "traces",
        tenantColumn: "TenantId",
        context: "key-map name shadowed by a CTE",
        query:
          `WITH ${harness.names.keyMapTable} AS (` +
          `  SELECT '${harness.tenantB.keyHash}' AS KeyHash, '${harness.tenantB.tenantId}' AS TenantId` +
          `) SELECT DISTINCT TenantId FROM ${database}.traces`,
      });
    });

    /** @scenario "Row policy holds across UNION ALL branches" */
    it("scopes every branch of a UNION ALL", async () => {
      await recordSeedControl({
        harness,
        table: "spans",
        tenantColumn: "TenantId",
      });
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "traces",
        tenantColumn: "TenantId",
        context: "UNION ALL",
        query:
          `SELECT TenantId FROM ${database}.traces ` +
          `UNION ALL SELECT TenantId FROM ${database}.spans`,
      });
    });

    /** @scenario "Row policy holds on both sides of a JOIN" */
    it("scopes both sides of a JOIN", async () => {
      await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      await recordSeedControl({
        harness,
        table: "spans",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{
        traceTenant: string;
        spanTenant: string;
      }>(
        tenantA,
        `SELECT t.TenantId AS traceTenant, s.TenantId AS spanTenant ` +
          `FROM ${database}.traces AS t ` +
          `INNER JOIN ${database}.spans AS s ON s.TraceId = t.TraceId`,
      );

      // Both sides checked: a join is two reads, and either could be the leak.
      expectOnlyTenantA({
        rows,
        tenantColumn: "traceTenant",
        harness,
        context: "JOIN left side",
      });
      expectOnlyTenantA({
        rows,
        tenantColumn: "spanTenant",
        harness,
        context: "JOIN right side",
      });
    });

    /**
     * Aliasing another governed table under the key map's name is the same
     * trick as the CTE shadow, in join position.
     */
    /** @scenario "Shadowing or aliasing the key-map table name does not defeat the policy" */
    it("scopes a JOIN that aliases another table as the key-map table", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "traces",
        tenantColumn: "TenantId",
        resultTenantColumn: "tenant",
        context: "key-map name reused as a join alias",
        query:
          `SELECT t.TenantId AS tenant FROM ${database}.traces AS t ` +
          `INNER JOIN ${database}.spans AS ${harness.names.keyMapTable} ` +
          `ON ${harness.names.keyMapTable}.TraceId = t.TraceId`,
      });
    });

    /** @scenario "Row policy holds inside subqueries" */
    it("scopes IN and scalar subquery positions", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "spans",
        tenantColumn: "TenantId",
        context: "IN subquery",
        query:
          `SELECT TenantId FROM ${database}.spans ` +
          `WHERE TraceId IN (SELECT TraceId FROM ${database}.traces)`,
      });

      const scalar = await selectScalar<string>(
        tenantA,
        `SELECT (SELECT DISTINCT TenantId FROM ${database}.traces) AS value`,
      );
      expect(scalar, "scalar subquery position leaked a foreign tenant").toBe(
        harness.tenantA.tenantId,
      );
    });

    /**
     * The correlated `EXISTS` shape is not supported by this engine version.
     * Asserted as the fail-closed rejection it is rather than left untested:
     * writing it as if it returned scoped rows would be a false claim, and
     * dropping it would hide that a whole subquery shape is unavailable.
     */
    /** @scenario "Row policy holds inside subqueries" */
    it("rejects a correlated EXISTS subquery rather than answering it unscoped", async () => {
      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT count() FROM ${database}.traces AS t ` +
              `WHERE EXISTS (SELECT 1 FROM ${database}.spans AS s WHERE s.TraceId = t.TraceId)`,
          ),
        CLICKHOUSE_ERROR_CODE.NOT_IMPLEMENTED,
        "correlated EXISTS subquery",
      );
    });

    /**
     * `merge()` reads several tables through one name, which looks like a way
     * around a per-table policy. It is not: the policies still apply, so the
     * assertion is containment, not rejection.
     */
    /** @scenario "The merge table function is contained by the row policies" */
    it("scopes reads through the merge() table function", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const visible = await selectScalar<string>(
        tenantA,
        `SELECT count() AS value FROM merge('${database}', '^traces$')`,
      );
      expect(Number(visible)).toBe(control.tenantA);
    });
  });

  describe("when the server's query log is inspected", () => {
    /** @scenario "Key hash is auditable in the query log without exposing the raw key" */
    it("records the key hash and never the raw secret", async () => {
      // Pins the construction the audit depends on: only a digest is ever sent.
      // The expected value is written out rather than recomputed, so this stays
      // an independent check — recomputing it here would only restate whatever
      // `governedTenantCapability` does and would agree with it after any
      // change, including a change that stopped hashing at all.
      expect(harness.tenantA.keyHash).toBe(
        "142385b8994fcc2c4e874cd550c2f9926e6dfecde7785a3138bd438239edadef",
      );
      expect(harness.tenantA.rawSecret.length).toBeGreaterThanOrEqual(24);

      const queryId = `governed-sql-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await selectRows(tenantA, `SELECT count() FROM ${database}.traces`, {
        query_id: queryId,
      });
      await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);

      const entries = await selectRows<Record<string, unknown>>(
        harness.admin,
        `SELECT * FROM system.query_log WHERE query_id = '${queryId}'`,
      );
      // A missing row must fail: otherwise "the raw secret appears nowhere"
      // is satisfied by there being nothing to look at.
      expect(
        entries.length,
        "no query_log entry for the audited query — the absence assertion below would be vacuous",
      ).toBeGreaterThan(0);

      for (const entry of entries) {
        const settings = entry.Settings as Record<string, string>;
        expect(
          settings[harness.names.tenantSetting],
          "the key hash is what makes a governed query auditable",
        ).toBe(auditedSettingValue(harness.tenantA.keyHash));

        // Serialised whole, so the check covers every column rather than the
        // handful someone thought to name.
        const serialised = JSON.stringify(entry);
        expect(
          serialised.includes(harness.tenantA.keyHash),
          "sanity: the hash should be findable in the serialised row",
        ).toBe(true);
        expect(
          serialised.includes(harness.tenantA.rawSecret),
          "the raw governed SQL key reached ClickHouse — only its hash may ever be sent",
        ).toBe(false);
      }
    });
  });

  describe("when a key hash is removed from the key map", () => {
    /** @scenario "Revoking a key hash from the key map takes effect within the stated revocation bound" */
    it("stops returning rows on the next query, with no refresh lag", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const revoked = await harness.restrictedClient({
        keyHash: harness.tenantA.keyHash,
      });
      const before = await selectScalar<string>(
        revoked,
        `SELECT count() AS value FROM ${database}.traces`,
      );
      expect(Number(before)).toBe(control.tenantA);

      try {
        await harness.applyAsAdmin([
          `ALTER TABLE ${database}.${harness.names.keyMapTable} ` +
            `DELETE WHERE KeyHash = '${harness.tenantA.keyHash}' SETTINGS mutations_sync = 2`,
        ]);

        const after = await selectScalar<string>(
          revoked,
          `SELECT count() AS value FROM ${database}.traces`,
        );
        expect(
          Number(after),
          `revoked key still reads rows while ${control.tenantA} exist`,
        ).toBe(0);
      } finally {
        await harness.admin.insert({
          table: `${database}.${harness.names.keyMapTable}`,
          format: "JSONEachRow",
          values: [
            {
              KeyHash: harness.tenantA.keyHash,
              TenantId: harness.tenantA.tenantId,
            },
          ],
        });
      }

      const restored = await selectScalar<string>(
        revoked,
        `SELECT count() AS value FROM ${database}.traces`,
      );
      expect(
        Number(restored),
        "the key map was not restored, later tests would read nothing",
      ).toBe(control.tenantA);
    });
  });

  describe("when the restricted identity reads the key map", () => {
    /** @scenario "The restricted identity cannot enumerate the key map beyond its own key" */
    it("sees its own row and no other tenant's key hash", async () => {
      const seeded = await selectRows<{ KeyHash: string }>(
        harness.admin,
        `SELECT KeyHash FROM ${database}.${harness.names.keyMapTable} ` +
          `WHERE KeyHash = '${harness.tenantB.keyHash}'`,
      );
      expect(
        seeded,
        "the victim hash is not in the key map — nothing below would be proving anything",
      ).toHaveLength(1);

      const visible = await selectRows<{ KeyHash: string; TenantId: string }>(
        tenantA,
        `SELECT * FROM ${database}.${harness.names.keyMapTable}`,
      );
      expect(visible).toEqual([
        {
          KeyHash: harness.tenantA.keyHash,
          TenantId: harness.tenantA.tenantId,
        },
      ]);
      expect(
        JSON.stringify(visible).includes(harness.tenantB.keyHash),
        "another tenant's key hash was enumerable",
      ).toBe(false);

      // Probing a hash the caller already guessed is answered as a miss, so the
      // key map cannot be used as an oracle to confirm one.
      const probe = await selectScalar<string>(
        tenantA,
        `SELECT count() AS value FROM ${database}.${harness.names.keyMapTable} ` +
          `WHERE KeyHash = '${harness.tenantB.keyHash}'`,
      );
      expect(Number(probe)).toBe(0);

      const tenants = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.${harness.names.keyMapTable}`,
      );
      expect(tenants.map((row) => row.TenantId)).toEqual([
        harness.tenantA.tenantId,
      ]);
    });

    /**
     * A dictionary is not subject to row policies, so a tenant-scoped one would
     * be a bypass with no policy to enforce — the reason the shipped key map is
     * a self-policed table instead.
     */
    /** @scenario "No dictionary in the governed schema could serve the same data unpoliced" */
    it("has no dictionary in the governed database that could serve the same data unpoliced", async () => {
      const dictionaries = await selectRows<{ name: string }>(
        harness.admin,
        governedDictionaryAuditQuery({ names: harness.names }),
      );
      expect(dictionaries).toEqual([]);
    });
  });

  describe("when the restricted identity attempts to write or change the schema", () => {
    /** @scenario "Writes, DDL, and temporary objects are rejected by the restricted identity itself" */
    it("rejects every write, DDL, and temporary-object statement by grants", async () => {
      const rejected: Array<[string, string]> = [
        [
          "INSERT",
          `INSERT INTO ${database}.traces VALUES ('tenant-b','x','m',1)`,
        ],
        ["ALTER", `ALTER TABLE ${database}.traces DELETE WHERE 1`],
        [
          "CREATE TABLE",
          `CREATE TABLE ${database}.evil (x UInt8) ENGINE = Memory`,
        ],
        ["CREATE TEMPORARY TABLE", "CREATE TEMPORARY TABLE evil (x UInt8)"],
        ["DROP", `DROP TABLE ${database}.traces`],
        ["TRUNCATE", `TRUNCATE TABLE ${database}.traces`],
        ["CREATE VIEW", `CREATE VIEW ${database}.evil_view AS SELECT 1`],
        [
          "ATTACH",
          `ATTACH TABLE ${database}.evil_attached (x UInt8) ENGINE = Memory`,
        ],
        [
          "CREATE ROW POLICY",
          `CREATE ROW POLICY evil ON ${database}.traces USING 1 TO ${harness.names.restrictedUser}`,
        ],
        [
          // Derived, not spelled by hand: ClickHouse checks the privilege
          // before it resolves the object, so a hardcoded name that no longer
          // matches any policy still raises ACCESS_DENIED and still passes —
          // while having stopped testing a refusal to drop a policy that
          // actually exists.
          "DROP ROW POLICY",
          dropGovernedRowPolicyStatement({
            names: harness.names,
            table: "traces",
          }),
        ],
        [
          "GRANT",
          `GRANT SELECT ON ${database}.traces TO ${harness.names.restrictedUser}`,
        ],
        [
          "CREATE USER",
          "CREATE USER evil IDENTIFIED WITH plaintext_password BY 'x'",
        ],
      ];

      for (const [label, query] of rejected) {
        await expectClickHouseError(
          runStatement(tenantA, query),
          CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          label,
        );
      }

      // The policy the reader tried to drop is still in force.
      const rows = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.traces`,
      );
      expect(rows.map((row) => row.TenantId)).toEqual([
        harness.tenantA.tenantId,
      ]);
    });

    /** @scenario "Multiple statements in one request are rejected" */
    it("rejects two statements submitted in one request", async () => {
      await expectClickHouseError(
        runStatement(tenantA, `SELECT 1; SELECT 2`),
        CLICKHOUSE_ERROR_CODE.SYNTAX_ERROR,
        "multi-statement request",
      );
    });
  });

  describe("when the restricted identity attempts to reach outside the governed schema", () => {
    /** @scenario "Table functions are rejected for the restricted identity by grants" */
    it("rejects the table functions that reach external systems", async () => {
      const rejected: Array<[string, string]> = [
        [
          "url",
          `SELECT * FROM url('http://example.invalid/', 'CSV', 'a String')`,
        ],
        [
          "s3",
          `SELECT * FROM s3('http://example.invalid/f.csv', 'CSV', 'a String')`,
        ],
        [
          "remote",
          `SELECT * FROM remote('127.0.0.1', 'system', 'one', 'u', 'p')`,
        ],
        ["file", `SELECT * FROM file('x.csv', 'CSV', 'a String')`],
        [
          "postgresql",
          `SELECT * FROM postgresql('127.0.0.1:5432', 'db', 'tbl', 'u', 'p')`,
        ],
      ];
      for (const [label, query] of rejected) {
        await expectClickHouseError(
          () => selectRows(tenantA, query),
          CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          `${label} table function`,
        );
      }
    });

    /**
     * The generators reach no data at all, so they are deliberately left
     * available rather than being holes in the grant policy. Pinned so that a
     * later blanket ban is a decision someone makes, not a silent regression.
     */
    /** @scenario "Table functions that read no data remain available" */
    it("still allows the table functions that read no data", async () => {
      const allowed: Array<[string, string]> = [
        ["numbers", "SELECT count() AS value FROM numbers(5)"],
        ["values", "SELECT count() AS value FROM values('x UInt8', 1, 2)"],
        ["view", "SELECT count() AS value FROM view(SELECT 1 AS x)"],
        [
          "generateRandom",
          "SELECT count() AS value FROM (SELECT * FROM generateRandom('a UInt8') LIMIT 3)",
        ],
      ];
      for (const [label, query] of allowed) {
        const count = await selectScalar<string>(tenantA, query);
        expect(Number(count), `${label} was refused`).toBeGreaterThan(0);
      }
    });

    /** @scenario "System and internal schema access is rejected for the restricted identity" */
    it("rejects the system tables holding users, query history, and policy definitions", async () => {
      const rejected = [
        "system.users",
        "system.query_log",
        "system.row_policies",
        "system.dictionaries",
        "system.grants",
        "system.settings_profiles",
        "system.named_collections",
        "information_schema.tables",
      ];
      for (const table of rejected) {
        await expectClickHouseError(
          () => selectRows(tenantA, `SELECT count() FROM ${table}`),
          CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          table,
        );
      }
    });

    /**
     * `system.settings` is readable and must not be asserted otherwise. It is
     * session-scoped: it exposes the caller's OWN tenant context and no other
     * tenant's, which is the property worth pinning.
     */
    /** @scenario "System and internal schema access is rejected for the restricted identity" */
    it("exposes only the caller's own tenant context through the readable settings view", async () => {
      const total = await selectScalar<string>(
        tenantA,
        "SELECT count() AS value FROM system.settings",
      );
      expect(
        Number(total),
        "system.settings is readable by design; a zero here means the check is measuring nothing",
      ).toBeGreaterThan(0);

      const own = await selectScalar<string>(
        tenantA,
        `SELECT value FROM system.settings WHERE name = '${harness.names.tenantSetting}'`,
      );
      expect(own).toBe(auditedSettingValue(harness.tenantA.keyHash));

      // Compared in TypeScript rather than in SQL: the value read back from
      // system.settings is the field-dumped form and already carries its own
      // quotes, so interpolating it into a SQL literal double-quotes it. This
      // also widens the check from one column to every setting in the view.
      const otherTenantValue = auditedSettingValue(harness.tenantB.keyHash);
      const allSettings = await selectRows<{ name: string; value: string }>(
        tenantA,
        "SELECT name, value FROM system.settings",
      );
      expect(
        allSettings.filter((setting) => setting.value === otherTenantValue),
        "another tenant's context was visible in the session settings view",
      ).toHaveLength(0);
    });

    /**
     * `system.tables` is readable too, but permission-filtered. Compared
     * against the grants rather than a hard-coded count, so adding a governed
     * object does not turn this red for the wrong reason.
     */
    /** @scenario "Only the granted objects are visible through the readable tables view" */
    it("shows only the granted objects through the readable tables view", async () => {
      const granted = await selectRows<{ table: string }>(
        harness.admin,
        `SELECT DISTINCT table FROM system.grants ` +
          `WHERE user_name = '${harness.names.restrictedUser}' AND database = '${database}' ` +
          `AND access_type = 'SELECT' AND table IS NOT NULL ` +
          `AND table IN (SELECT name FROM system.tables WHERE database = '${database}') ` +
          `ORDER BY table`,
      );
      expect(granted.length).toBeGreaterThan(0);

      const visible = await selectRows<{ name: string }>(
        tenantA,
        `SELECT name FROM system.tables WHERE database = '${database}' ORDER BY name`,
      );
      expect(visible.map((row) => row.name)).toEqual(
        granted.map((row) => row.table),
      );
    });
  });

  describe("when the governed database's own definitions are audited", () => {
    /**
     * Enumerated from the server rather than from a list in this file: adding a
     * governed object and granting it without writing its row policy turns this
     * red with no test edit.
     */
    /** @scenario "Every governed object has an effective row policy" */
    it("has an effective row policy for every object the restricted identity can read", async () => {
      const coverage = await selectRows<{ table: string; has_policy: number }>(
        harness.admin,
        governedPolicyCoverageQuery({ names: harness.names }),
      );
      expect(
        coverage.length,
        "no exposed objects found — the coverage check would certify nothing",
      ).toBeGreaterThan(0);
      const uncovered = coverage
        .filter((row) => Number(row.has_policy) !== 1)
        .map((row) => row.table);
      expect(
        uncovered,
        "governed objects are readable with no row policy applying to the restricted identity",
      ).toEqual([]);
    });

    /**
     * A `SQL SECURITY DEFINER` view reads its sources as its definer rather
     * than as the caller, so row policies simply do not apply to it — a
     * complete bypass of the model. Proved here so the hazard is documented and
     * falsifiable, and immediately followed by the guard that would catch one,
     * exercised against a real offender so the guard cannot be vacuous.
     */
    /** @scenario "A definer-rights view bypasses the row policy and is reported by the audit" */
    it("detects a DEFINER view as the row-policy bypass it is, and reports a clean database otherwise", async () => {
      const definerView = "v_definer_probe";
      const invokerView = "v_invoker_probe";

      const cleanBefore = await selectRows(
        harness.admin,
        definerViewAuditQuery({ names: harness.names }),
      );
      expect(
        cleanBefore,
        "the governed database already contains a DEFINER view",
      ).toEqual([]);

      let definerTenants: string[] = [];
      let invokerTenants: string[] = [];
      let flagged: string[] = [];
      try {
        await harness.applyAsAdmin([
          `CREATE VIEW ${database}.${definerView} DEFINER = CURRENT_USER SQL SECURITY DEFINER ` +
            `AS SELECT TenantId, TraceId FROM ${database}.traces`,
          `CREATE VIEW ${database}.${invokerView} SQL SECURITY INVOKER ` +
            `AS SELECT TenantId, TraceId FROM ${database}.traces`,
          governedGrantStatement({ names: harness.names, table: definerView }),
          governedGrantStatement({ names: harness.names, table: invokerView }),
        ]);

        definerTenants = (
          await selectRows<{ TenantId: string }>(
            tenantA,
            `SELECT DISTINCT TenantId FROM ${database}.${definerView} ORDER BY TenantId`,
          )
        ).map((row) => row.TenantId);
        invokerTenants = (
          await selectRows<{ TenantId: string }>(
            tenantA,
            `SELECT DISTINCT TenantId FROM ${database}.${invokerView} ORDER BY TenantId`,
          )
        ).map((row) => row.TenantId);
        flagged = (
          await selectRows<{ name: string }>(
            harness.admin,
            definerViewAuditQuery({ names: harness.names }),
          )
        ).map((row) => row.name);
      } finally {
        // The grant OUTLIVES the drop, so revoking is not optional: a leftover
        // grant on a vanished object would poison the coverage audit.
        await harness.applyAsAdmin([
          `REVOKE SELECT ON ${database}.${definerView} FROM ${harness.names.restrictedUser}`,
          `REVOKE SELECT ON ${database}.${invokerView} FROM ${harness.names.restrictedUser}`,
          `DROP TABLE IF EXISTS ${database}.${definerView}`,
          `DROP TABLE IF EXISTS ${database}.${invokerView}`,
        ]);
      }

      expect(
        definerTenants,
        "a DEFINER view no longer bypasses row policies — the guard below may be unnecessary",
      ).toEqual([harness.tenantA.tenantId, harness.tenantB.tenantId]);
      expect(invokerTenants).toEqual([harness.tenantA.tenantId]);
      expect(
        flagged,
        "the audit did not flag a DEFINER view, so it would not catch one that shipped",
      ).toContain(definerView);

      const cleanAfter = await selectRows(
        harness.admin,
        definerViewAuditQuery({ names: harness.names }),
      );
      expect(cleanAfter).toEqual([]);
    });
  });
});
