/**
 * Isolation proof, part 2: PostgreSQL-resident data reached through
 * named-collection PostgreSQL-engine tables.
 *
 * There is no PostgreSQL endpoint and no PostgreSQL executor in this design.
 * PG-resident data is mapped into the governed ClickHouse database as an engine
 * table over a server-side named collection, and policed by exactly the same
 * row policy as a native table. This file proves that the mapping does not
 * open a second door: not around the row policy, not around read-only, and not
 * around the credentials.
 *
 * The containment is layered on purpose, and each layer is asserted
 * independently: ClickHouse's row policy bounds which tenant's rows a caller
 * sees, while the dedicated PostgreSQL role bounds what the mapping could ever
 * reach even if ClickHouse were wrong about the first part. The PG role itself
 * is NOT tenant-scoped — it sees every tenant's rows in the approved view — so
 * asserting the ClickHouse-side policy is the only thing that proves tenant
 * isolation here.
 *
 * @see specs/analytics/governed-sql-api.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLICKHOUSE_ERROR_CODE,
  expectClickHouseError,
  expectOnlyTenantA,
  expectPostgresError,
  expectRestrictedIdentity,
  expectTenantScopedRead,
  expectZeroRowsWithControl,
  type GovernedClickHouseHarness,
  type GovernedPostgresHarness,
  mapPostgresIntoClickHouse,
  PG_MAPPED_TABLE,
  PG_MAPPED_TENANT_COLUMN,
  POSTGRES_SQLSTATE,
  recordSeedControl,
  runStatement,
  selectRows,
  selectScalar,
  startGovernedClickHouse,
  startGovernedPostgres,
  statementsLoggedSince,
} from "./governedClickHouseHarness";

describe("given a PG-resident table mapped into ClickHouse through the server-side named collection", () => {
  let harness: GovernedClickHouseHarness;
  let postgres: GovernedPostgresHarness;
  /** The restricted identity carrying tenant-a's valid key-hash context. */
  let tenantA: ClickHouseClient;
  let database: string;

  beforeAll(async () => {
    postgres = await startGovernedPostgres();
    harness = await startGovernedClickHouse({ suite: "pgengine" });
    database = harness.names.database;
    await mapPostgresIntoClickHouse({ harness, postgres });
    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
  }, 240_000);

  afterAll(async () => {
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when the restricted identity carries a valid key-hash context", () => {
    /** @scenario "A PG-resident table is readable through ClickHouse only within the caller's tenant rows" */
    it("reads its own tenant's mapped rows and none of the other tenant's", async () => {
      await expectRestrictedIdentity({ client: tenantA, names: harness.names });
      const control = await recordSeedControl({
        harness,
        table: PG_MAPPED_TABLE,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
      });

      const rows = await selectRows<{ id: string; tenant_id: string }>(
        tenantA,
        `SELECT id, ${PG_MAPPED_TENANT_COLUMN} FROM ${database}.${PG_MAPPED_TABLE} ORDER BY id`,
      );

      expectOnlyTenantA({
        rows,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
        harness,
        context: "mapped table baseline read",
      });
      expect(rows).toHaveLength(control.tenantA);
    });

    /**
     * The column the approved view omits is unreachable, not merely unselected:
     * the PG role has no grant on the base table, so there is no path to it.
     */
    /** @scenario "A column the approved view excludes is unreachable through the mapping" */
    it("cannot reach a column the approved view excludes", async () => {
      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT secret_note FROM ${database}.${PG_MAPPED_TABLE}`,
          ),
        CLICKHOUSE_ERROR_CODE.UNKNOWN_IDENTIFIER,
        "content-excluded column",
      );

      const serialised = JSON.stringify(
        await selectRows(
          tenantA,
          `SELECT * FROM ${database}.${PG_MAPPED_TABLE}`,
        ),
      );
      expect(
        serialised.includes("secret-of-"),
        "the excluded column's data reached the governed schema",
      ).toBe(false);
    });
  });

  describe("when the key-hash context matches no key-map entry", () => {
    /** @scenario "Garbage key context yields zero rows from a PG-engine mapped table" */
    it("returns zero rows from the mapped table", async () => {
      await expectZeroRowsWithControl({
        harness,
        keyHash: "not-a-real-key-hash",
        table: PG_MAPPED_TABLE,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
        context: "garbage key against the mapped table",
      });
    });

    /** @scenario "Empty key context yields zero rows from a PG-engine mapped table" */
    it("returns zero rows from the mapped table for an empty context", async () => {
      await expectZeroRowsWithControl({
        harness,
        keyHash: "",
        table: PG_MAPPED_TABLE,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
        context: "empty key against the mapped table",
      });
    });
  });

  describe("when the mapped table is nested in a compound query shape", () => {
    /** @scenario "Row policy on a PG-engine mapped table holds under CTE, UNION, JOIN, and subquery shapes" */
    it("scopes the mapped table through a CTE", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: PG_MAPPED_TABLE,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
        context: "mapped table in a CTE",
        query:
          `WITH scoped AS (SELECT id, ${PG_MAPPED_TENANT_COLUMN} FROM ${database}.${PG_MAPPED_TABLE}) ` +
          `SELECT id, ${PG_MAPPED_TENANT_COLUMN} FROM scoped ORDER BY id`,
      });
    });

    /** @scenario "Row policy on a PG-engine mapped table holds under CTE, UNION, JOIN, and subquery shapes" */
    it("scopes every branch of a UNION ALL mixing the mapped table with a native one", async () => {
      await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: PG_MAPPED_TABLE,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
        resultTenantColumn: "tenant",
        context: "mapped table in a UNION ALL",
        query:
          `SELECT ${PG_MAPPED_TENANT_COLUMN} AS tenant FROM ${database}.${PG_MAPPED_TABLE} ` +
          `UNION ALL SELECT TenantId AS tenant FROM ${database}.traces`,
      });
    });

    /** @scenario "Row policy on a PG-engine mapped table holds under CTE, UNION, JOIN, and subquery shapes" */
    it("scopes both sides of a JOIN between the mapped table and a ClickHouse fact table", async () => {
      await recordSeedControl({
        harness,
        table: PG_MAPPED_TABLE,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
      });
      await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{
        annotationTenant: string;
        traceTenant: string;
      }>(
        tenantA,
        `SELECT a.${PG_MAPPED_TENANT_COLUMN} AS annotationTenant, t.TenantId AS traceTenant ` +
          `FROM ${database}.${PG_MAPPED_TABLE} AS a ` +
          `INNER JOIN ${database}.traces AS t ON t.TraceId = a.trace_id`,
      );

      expectOnlyTenantA({
        rows,
        tenantColumn: "annotationTenant",
        harness,
        context: "mapped-table join side",
      });
      expectOnlyTenantA({
        rows,
        tenantColumn: "traceTenant",
        harness,
        context: "fact-table join side",
      });
    });

    /** @scenario "Row policy on a PG-engine mapped table holds under CTE, UNION, JOIN, and subquery shapes" */
    it("scopes the mapped table in IN and scalar subquery positions", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: PG_MAPPED_TABLE,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
        context: "mapped table in an IN subquery",
        query:
          `SELECT ${PG_MAPPED_TENANT_COLUMN} FROM ${database}.${PG_MAPPED_TABLE} ` +
          `WHERE trace_id IN (SELECT TraceId FROM ${database}.traces)`,
      });

      const scalar = await selectScalar<string>(
        tenantA,
        `SELECT (SELECT DISTINCT ${PG_MAPPED_TENANT_COLUMN} FROM ${database}.${PG_MAPPED_TABLE}) AS value`,
      );
      expect(scalar).toBe(harness.tenantA.tenantId);
    });
  });

  describe("when the restricted identity attempts to write through the mapping", () => {
    /** @scenario "The restricted identity cannot write through a PG-engine mapped table" */
    it("rejects an INSERT into the mapped table by grants", async () => {
      await expectClickHouseError(
        runStatement(
          tenantA,
          `INSERT INTO ${database}.${PG_MAPPED_TABLE} VALUES ` +
            `('injected', '${harness.tenantB.tenantId}', 'trace', 'up')`,
        ),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        "INSERT into the mapped table",
      );

      // Nothing reached PostgreSQL: the base table is unchanged.
      const rows = await postgres.asAdmin(
        `SELECT count(*) FROM ${postgres.baseTable} WHERE id = 'injected'`,
      );
      expect(rows.exitCode).toBe(0);
      expect(rows.stdout.trim()).toBe("0");
    });
  });

  describe("when a write is attempted on PostgreSQL as the dedicated role", () => {
    /** @scenario "The dedicated PG role is read-only at the PostgreSQL layer" */
    it("rejects writes and reads only the explicitly approved view", async () => {
      // Positive control: the role can read what it is meant to read, so the
      // rejections below are about privilege rather than a broken connection.
      const approved = await postgres.asReader(
        `SELECT count(*) FROM ${postgres.approvedView}`,
      );
      expect(approved.exitCode, approved.stderr).toBe(0);
      expect(Number(approved.stdout.trim())).toBeGreaterThan(0);

      expectPostgresError(
        await postgres.asReader(`SELECT count(*) FROM ${postgres.baseTable}`),
        POSTGRES_SQLSTATE.INSUFFICIENT_PRIVILEGE,
        "reading the base table behind the approved view",
      );
      expectPostgresError(
        await postgres.asReader(
          `INSERT INTO ${postgres.baseTable} VALUES ('x','tenant-a','t','up',NULL)`,
        ),
        POSTGRES_SQLSTATE.READ_ONLY_TRANSACTION,
        "inserting as the dedicated role",
      );
      expectPostgresError(
        await postgres.asReader("CREATE TABLE governed_probe (x int)"),
        POSTGRES_SQLSTATE.READ_ONLY_TRANSACTION,
        "creating a table as the dedicated role",
      );

      const readOnly = await postgres.asReader(
        "SELECT current_setting('default_transaction_read_only')",
      );
      expect(readOnly.stdout.trim()).toBe("on");
    });
  });

  describe("when the restricted identity inspects the mapping", () => {
    /** @scenario "PG connection credentials are not exposed to the restricted identity" */
    it("reveals the collection name but no PostgreSQL credential", async () => {
      const shown = await selectRows<{ statement: string }>(
        tenantA,
        `SHOW CREATE TABLE ${database}.${PG_MAPPED_TABLE}`,
      );
      const definition = JSON.stringify(shown);

      // Positive control: we are looking at the mapped table's real definition.
      expect(definition).toContain("PostgreSQL(");
      expect(definition).toContain(postgres.approvedView);

      for (const secret of [
        "governed-pg-reader-test-password",
        postgres.readerRole,
        String(postgres.container.getPort()),
        "host.docker.internal",
      ]) {
        expect(
          definition.includes(secret),
          `the mapped table definition leaked "${secret}" to the restricted identity`,
        ).toBe(false);
      }

      await expectClickHouseError(
        () => selectRows(tenantA, "SELECT * FROM system.named_collections"),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        "reading the server's named collections",
      );

      // The collection can only be used through the objects an administrator
      // built with it, never through a table function the caller writes.
      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT * FROM postgresql(pg_analytics, table='${postgres.baseTable}')`,
          ),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        "using the named collection through a table function",
      );
    });
  });

  describe("when the load the mapping places on PostgreSQL is measured", () => {
    /**
     * A known limitation, measured rather than asserted from prose.
     *
     * The security property holds — a garbage key returns nothing — but the
     * containment property does not: ClickHouse pushes the caller's own
     * predicates down to PostgreSQL, and does NOT push the row policy's
     * predicate down. Every governed read of a mapped table therefore scans the
     * whole approved view on the primary and filters afterwards, including a
     * read that is about to return zero rows.
     *
     * This is what gates the "per-table latency and load measurements" AC and
     * the projection fallback in the later PR of #6480, so it is pinned here
     * rather than discovered in production.
     */
    /** @scenario "The row-policy predicate is not pushed down to PostgreSQL" */
    it("scans the whole approved view on PostgreSQL even for a key that can match no row", async () => {
      const before = await postgres.readLog();
      const client = await harness.restrictedClient({
        keyHash: "not-a-real-key-hash",
      });
      const rows = await selectRows(
        client,
        `SELECT count() FROM ${database}.${PG_MAPPED_TABLE}`,
      );
      expect(rows).toHaveLength(1);

      const statements = statementsLoggedSince(
        before,
        await postgres.readLog(),
      );
      const scans = statements.filter((statement) =>
        statement.includes(postgres.approvedView),
      );
      // Without this the whole measurement passes vacuously on an empty delta.
      expect(
        scans.length,
        "no statement against the approved view was logged — the measurement captured nothing",
      ).toBeGreaterThan(0);

      for (const scan of scans) {
        expect(
          /\bWHERE\b/i.test(scan),
          `the row policy predicate now pushes down ("${scan}") — the projection fallback may no longer be needed`,
        ).toBe(false);
      }
      expect(
        statements.some((statement) => /^BEGIN READ ONLY$/i.test(statement)),
        "reads are not wrapped in a read-only transaction",
      ).toBe(true);
    });

    /**
     * The control for the finding above: a predicate the *caller* wrote does
     * push down, so the absent WHERE is specific to the policy predicate rather
     * than a sign that pushdown is off altogether.
     */
    /** @scenario "A predicate in the submitted SQL is pushed down to PostgreSQL" */
    it("does push the caller's own predicate down to PostgreSQL", async () => {
      const before = await postgres.readLog();
      await selectRows(
        tenantA,
        `SELECT id FROM ${database}.${PG_MAPPED_TABLE} ` +
          `WHERE trace_id = '${harness.tenantA.tenantId}-trace-1'`,
      );

      const statements = statementsLoggedSince(
        before,
        await postgres.readLog(),
      );
      const scans = statements.filter((statement) =>
        statement.includes(postgres.approvedView),
      );
      expect(scans.length).toBeGreaterThan(0);
      expect(
        scans.some((scan) => scan.includes("trace_id")),
        "the caller's predicate did not reach PostgreSQL at all",
      ).toBe(true);
    });
  });
});
