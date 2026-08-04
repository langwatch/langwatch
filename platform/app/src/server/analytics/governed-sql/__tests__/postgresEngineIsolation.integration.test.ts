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
 * ## Two objects, and the difference between them is the point
 *
 * `<dataset>_pg` is the engine table: policed, and read by ClickHouse as a
 * whole-table scan on the primary. `<dataset>` is the governed view over it,
 * which a caller names and which additionally carries the tenant predicate that
 * *does* push down. Reading both is what separates the security property from
 * the load property — the first holds on either object, the second only on the
 * view.
 *
 * @see specs/analytics/governed-sql-api.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOVERNED_VIEW_CATALOG } from "../catalog/governedViews";
import { governedPostgresViews } from "../catalog/types";
import { DEFAULT_POSTGRES_ENGINE_POOL_SIZE } from "../postgresMapping";
import {
  governedPostgresReaderConnectionLimit,
  governedViewSetupStatements,
  SHIPPED_GOVERNED_DEDUP,
} from "../views";
import {
  CLICKHOUSE_ERROR_CODE,
  expectClickHouseError,
  expectOnlyTenantA,
  expectPostgresError,
  expectRestrictedIdentity,
  expectTenantScopedRead,
  expectZeroRowsWithControl,
  GOVERNED_TEST_POSTGRES_CONNECTION_LIMIT,
  type GovernedClickHouseHarness,
  type GovernedPostgresHarness,
  governedTestNamedCollection,
  mapPostgresIntoClickHouse,
  PG_EXCLUDED_COLUMN,
  PG_MAPPED_TABLE,
  PG_MAPPED_TENANT_COLUMN,
  PG_MAPPED_VIEW,
  POSTGRES_SQLSTATE,
  recordSeedControl,
  runStatement,
  selectRows,
  selectScalar,
  startGovernedClickHouse,
  startGovernedPostgres,
  statementsLoggedSince,
} from "./governedClickHouseHarness";

/** The PostgreSQL-resident half of the shipped catalog, provisioned whole. */
const POSTGRES_VIEWS = governedPostgresViews(GOVERNED_VIEW_CATALOG);

describe("given the PostgreSQL-resident catalog mapped into ClickHouse through the server-side named collection", () => {
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
    // The governed views over the engine tables — the objects a caller names.
    // Only the PostgreSQL-resident half: the ClickHouse-resident entries read
    // migrated fact tables this suite does not stand up.
    await harness.applyAsAdmin(
      governedViewSetupStatements({
        names: harness.names,
        sourceDatabase: harness.factDatabase,
        views: POSTGRES_VIEWS,
        dedup: SHIPPED_GOVERNED_DEDUP,
      }),
    );
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

      const rows = await selectRows<{
        AnnotationId: string;
        TenantId: string;
      }>(
        tenantA,
        `SELECT AnnotationId, ${PG_MAPPED_TENANT_COLUMN} FROM ${database}.${PG_MAPPED_TABLE} ORDER BY AnnotationId`,
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
     * Every mapped dataset, not only the one the rest of the file probes: a
     * dimension added to the catalog without a policy would be a silent
     * cross-tenant read, and this is what turns that into a failure.
     *
     * Deliberately reads the *engine tables* and not the governed views over
     * them. The view carries its own tenant predicate, so a view read would
     * come back correctly scoped even with the row policy missing entirely —
     * it would assert the two layers together and prove neither. The engine
     * table has only the policy, which is the layer this case is about.
     */
    /** @scenario "Every PostgreSQL-resident dataset in the catalog is tenant-scoped" */
    it("scopes every PostgreSQL-resident dataset to the caller's tenant", async () => {
      expect(
        POSTGRES_VIEWS.length,
        "the catalog carries no PostgreSQL-resident datasets — this whole file would be vacuous",
      ).toBeGreaterThan(0);

      for (const view of POSTGRES_VIEWS) {
        await expectTenantScopedRead({
          harness,
          client: tenantA,
          table: view.sourceTable,
          tenantColumn: PG_MAPPED_TENANT_COLUMN,
          context: `mapped table behind ${view.name}`,
          query: `SELECT ${PG_MAPPED_TENANT_COLUMN} FROM ${database}.${view.sourceTable}`,
        });
      }
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
            `SELECT ${PG_EXCLUDED_COLUMN} FROM ${database}.${PG_MAPPED_VIEW}`,
          ),
        CLICKHOUSE_ERROR_CODE.UNKNOWN_IDENTIFIER,
        "content-excluded column",
      );

      // Every excluded column of every mapped dataset, by its seeded marker:
      // the exclusion policy is per column, so proving one says nothing about
      // the prompt text or the evaluated rows.
      for (const view of POSTGRES_VIEWS) {
        const serialised = JSON.stringify(
          await selectRows(tenantA, `SELECT * FROM ${database}.${view.name}`),
        );
        expect(
          serialised.includes("excluded-"),
          `${view.name}: an excluded column's data reached the governed schema`,
        ).toBe(false);
      }
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
          `WITH scoped AS (SELECT AnnotationId, ${PG_MAPPED_TENANT_COLUMN} FROM ${database}.${PG_MAPPED_TABLE}) ` +
          `SELECT AnnotationId, ${PG_MAPPED_TENANT_COLUMN} FROM scoped ORDER BY AnnotationId`,
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
          `INNER JOIN ${database}.traces AS t ON t.TraceId = a.TraceId`,
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
          `WHERE TraceId IN (SELECT TraceId FROM ${database}.traces)`,
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
            `('${harness.tenantB.tenantId}', 'injected', 'trace', true, ` +
            `'2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
        ),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        "INSERT into the mapped table",
      );

      // Nothing reached PostgreSQL: the base table is unchanged.
      const rows = await postgres.asAdmin(
        `SELECT count(*) FROM public."${postgres.baseTable}" WHERE "id" = 'injected'`,
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
        `SELECT count(*) FROM public."${postgres.approvedView}"`,
      );
      expect(approved.exitCode, approved.stderr).toBe(0);
      expect(Number(approved.stdout.trim())).toBeGreaterThan(0);

      expectPostgresError(
        await postgres.asReader(
          `SELECT count(*) FROM public."${postgres.baseTable}"`,
        ),
        POSTGRES_SQLSTATE.INSUFFICIENT_PRIVILEGE,
        "reading the base table behind the approved view",
      );
      expectPostgresError(
        await postgres.asReader(
          `INSERT INTO public."${postgres.baseTable}" VALUES ` +
            `('x','tenant-a','t',true,NULL,NULL,now(),now())`,
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

    /**
     * The two ceilings that bound what the analytics path can take from the
     * primary. Read back from the server rather than asserted against the
     * statement text, because a `CONNECTION LIMIT` that never applied would
     * still be present in the SQL that tried to set it.
     */
    /** @scenario "The dedicated PG role is bounded by a statement timeout and a connection cap" */
    it("carries a statement timeout and a connection cap on the primary", async () => {
      const timeout = await postgres.asReader(
        "SELECT current_setting('statement_timeout')",
      );
      expect(timeout.exitCode, timeout.stderr).toBe(0);
      expect(timeout.stdout.trim()).toBe("10s");

      // The cap is derived from the catalog, not chosen: every mapped table
      // holds its own connection pool open, so a number sized for one dataset
      // is exhausted by six — and it fails by refusing the role's next login,
      // not by queueing.
      const limit = await postgres.asAdmin(
        `SELECT rolconnlimit FROM pg_roles WHERE rolname = '${postgres.readerRole}'`,
      );
      expect(limit.exitCode, limit.stderr).toBe(0);
      expect(Number(limit.stdout.trim())).toBe(
        GOVERNED_TEST_POSTGRES_CONNECTION_LIMIT,
      );
      // And the shipped one-deployment derivation clears one catalog's demand,
      // which is the property production depends on.
      expect(
        governedPostgresReaderConnectionLimit(),
        "the cap does not clear the pools the catalog's mapped tables hold open",
      ).toBeGreaterThan(
        POSTGRES_VIEWS.length * DEFAULT_POSTGRES_ENGINE_POOL_SIZE - 1,
      );

      // The timeout is enforced, not merely configured.
      expectPostgresError(
        await postgres.asReader("SELECT pg_sleep(12)"),
        POSTGRES_SQLSTATE.QUERY_CANCELED,
        "a query outrunning the role's statement timeout",
      );
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
            `SELECT * FROM postgresql(${governedTestNamedCollection(harness.names)}, table='${postgres.baseTable}')`,
          ),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        "using the named collection through a table function",
      );
    });
  });

  describe("when the load the mapping places on PostgreSQL is measured", () => {
    /**
     * The finding the governed view's tenant predicate exists to fix, pinned
     * here rather than argued from prose.
     *
     * The security property holds on the bare engine table — a garbage key
     * returns nothing — but the containment property does not: ClickHouse does
     * NOT push the row policy's predicate down, so a read of the engine table
     * scans the whole approved view on the primary and filters afterwards,
     * including a read that is about to return zero rows.
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
          `the row policy predicate now pushes down ("${scan}") — the governed view's tenant predicate may no longer be needed`,
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
        `SELECT AnnotationId FROM ${database}.${PG_MAPPED_TABLE} ` +
          `WHERE TraceId = '${harness.tenantA.tenantId}-trace-1'`,
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
        scans.some((scan) => scan.includes("TraceId")),
        "the caller's predicate did not reach PostgreSQL at all",
      ).toBe(true);
    });

    /**
     * The fix. The governed view carries a tenant predicate that ClickHouse
     * folds to a constant and sends, so the primary is asked for one tenant's
     * rows rather than every tenant's — with the caller's SQL untouched.
     */
    /** @scenario "The governed view sends a tenant predicate PostgreSQL can use" */
    it("pushes the caller's tenant down to PostgreSQL when the governed view is read", async () => {
      const before = await postgres.readLog();
      await selectRows(
        tenantA,
        `SELECT count() FROM ${database}.${PG_MAPPED_VIEW}`,
      );

      const scans = statementsLoggedSince(
        before,
        await postgres.readLog(),
      ).filter((statement) => statement.includes(postgres.approvedView));
      expect(
        scans.length,
        "no statement against the approved view was logged — the measurement captured nothing",
      ).toBeGreaterThan(0);
      for (const scan of scans) {
        expect(
          scan.includes(`= '${harness.tenantA.tenantId}'`),
          `the governed view's tenant predicate did not reach PostgreSQL ("${scan}")`,
        ).toBe(true);
      }
      // The caller's tenant, never the other one, and never the raw key.
      const joined = scans.join("\n");
      expect(joined).not.toContain(harness.tenantB.tenantId);
      expect(joined).not.toContain(harness.tenantA.rawApiKey);
    });

    /**
     * The containment, as rows off the primary rather than as statement text.
     *
     * This is the measurement the projection-fallback decision turns on: the
     * engine table costs every tenant's rows, the governed view costs the
     * caller's, and an unknown key costs none.
     */
    /** @scenario "The governed view bounds what PostgreSQL reads to the caller's tenant" */
    it("reads fewer rows off the primary through the view than through the engine table", async () => {
      const measure = async (relation: string, keyHash: string) => {
        await postgres.resetStatistics();
        const client = await harness.restrictedClient({ keyHash });
        await selectRows(client, `SELECT count() FROM ${database}.${relation}`);
        await postgres.flushStatistics();
        return postgres.rowsRead(postgres.baseTable);
      };

      const withoutPredicate = await measure(
        PG_MAPPED_TABLE,
        harness.tenantA.keyHash,
      );
      const withPredicate = await measure(
        PG_MAPPED_VIEW,
        harness.tenantA.keyHash,
      );
      const unknownKey = await measure(PG_MAPPED_VIEW, "not-a-real-key-hash");

      // Control: the unpredicated read must actually have cost something, or
      // "fewer" below is a comparison between two zeroes.
      expect(
        withoutPredicate,
        "reading the engine table cost no rows on the primary — the comparison is vacuous",
      ).toBeGreaterThan(0);
      expect(withPredicate).toBeLessThan(withoutPredicate);
      expect(unknownKey).toBe(0);
    }, 120_000);

    /**
     * The safety property, proven rather than argued: the pushed-down predicate
     * is a performance control that cannot become a security hole.
     *
     * A view whose predicate names the *wrong* tenant makes PostgreSQL read and
     * ship that tenant's rows — asserted from the statement PostgreSQL received
     * and from the rows it read, so the predicate demonstrably did reach it —
     * and the caller still receives none, because the row policy on the engine
     * table underneath is what decides the answer.
     */
    /** @scenario "A wrong tenant predicate costs a wrong read and never a wrong answer" */
    it("returns zero rows when the pushed-down predicate names a foreign tenant", async () => {
      const probe = `${PG_MAPPED_VIEW}_wrong_tenant_probe`;
      try {
        await harness.applyAsAdmin([
          `CREATE OR REPLACE VIEW ${database}.${probe}\n` +
            `SQL SECURITY INVOKER\n` +
            `AS SELECT src.${PG_MAPPED_TENANT_COLUMN} AS ${PG_MAPPED_TENANT_COLUMN}, ` +
            `src.AnnotationId AS AnnotationId\n` +
            `FROM ${database}.${PG_MAPPED_TABLE} AS src\n` +
            `WHERE src.${PG_MAPPED_TENANT_COLUMN} = '${harness.tenantB.tenantId}'`,
          `GRANT SELECT ON ${database}.${probe} TO ${harness.names.restrictedUser}`,
        ]);

        const control = await recordSeedControl({
          harness,
          table: PG_MAPPED_TABLE,
          tenantColumn: PG_MAPPED_TENANT_COLUMN,
        });
        await postgres.resetStatistics();
        const before = await postgres.readLog();

        const rows = await selectRows(
          tenantA,
          `SELECT * FROM ${database}.${probe}`,
        );

        const scans = statementsLoggedSince(
          before,
          await postgres.readLog(),
        ).filter((statement) => statement.includes(postgres.approvedView));
        await postgres.flushStatistics();
        const rowsReadOnPrimary = await postgres.rowsRead(postgres.baseTable);

        // The foreign predicate really did reach PostgreSQL, and PostgreSQL
        // really did read those rows: without both, "zero rows out" would prove
        // nothing about what the predicate can and cannot do.
        expect(
          scans.some((scan) =>
            scan.includes(`= '${harness.tenantB.tenantId}'`),
          ),
          `the foreign predicate never reached PostgreSQL:\n${scans.join("\n")}`,
        ).toBe(true);
        expect(
          rowsReadOnPrimary,
          "PostgreSQL read nothing, so the row policy was never the thing that filtered",
        ).toBeGreaterThan(0);

        expect(
          rows,
          `expected zero rows while ${control.tenantB} foreign rows were fetched`,
        ).toHaveLength(0);
      } finally {
        // Same discipline as the DEFINER-view probe in
        // `tenantIsolation.integration.test.ts`: the grant outlives the drop,
        // and a container this suite reuses across runs would otherwise keep
        // both the probe view and its grant on the restricted user forever.
        await harness.applyAsAdmin([
          `REVOKE SELECT ON ${database}.${probe} FROM ${harness.names.restrictedUser}`,
          `DROP TABLE IF EXISTS ${database}.${probe}`,
        ]);
      }
    }, 120_000);
  });

  describe("when the key map holds a duplicate row for the caller's key", () => {
    /**
     * The bug this pins: the key map is `ORDER BY KeyHash` with no uniqueness
     * enforced, so a retried provisioning step or a re-issued key can leave two
     * rows the key map's own self-policy admits for the same hash. The governed
     * view's tenant predicate (`postgresTenantPredicate` in `../views.ts`) is a
     * scalar subquery over exactly that self-policed read — before its
     * `LIMIT 1`, two admitted rows made the subquery return two rows and
     * ClickHouse rejected the whole read with
     * `Code: 125. INCORRECT_RESULT_OF_SCALAR_SUBQUERY`, taking out every
     * PostgreSQL-resident dataset for the affected key at once.
     */
    /** @scenario "A duplicate key-map row does not break a PostgreSQL-resident read" */
    it("reads its own tenant's rows through a PG-resident view when its key hash is duplicated", async () => {
      const control = await recordSeedControl({
        harness,
        table: PG_MAPPED_TABLE,
        tenantColumn: PG_MAPPED_TENANT_COLUMN,
      });

      try {
        // A retried provisioning step or a re-issued key: same hash, same
        // tenant — duplicates are copies, per the module comment this pins —
        // a second row alongside the one every other test in this file
        // depends on.
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

        let thrown: unknown;
        let rows: { AnnotationId: string; TenantId: string }[] = [];
        try {
          rows = await selectRows<{ AnnotationId: string; TenantId: string }>(
            tenantA,
            `SELECT AnnotationId, ${PG_MAPPED_TENANT_COLUMN} FROM ${database}.${PG_MAPPED_VIEW} ORDER BY AnnotationId`,
          );
        } catch (error) {
          thrown = error;
        }

        expect(
          thrown,
          `reading the PG-resident view with a duplicated key-map row was rejected: ${String(thrown)}`,
        ).toBeUndefined();
        expectOnlyTenantA({
          rows,
          tenantColumn: PG_MAPPED_TENANT_COLUMN,
          harness,
          context: "PG-resident view read behind a duplicated key-map row",
        });
        expect(rows).toHaveLength(control.tenantA);
      } finally {
        // Both rows share a hash, so restoring means clearing it entirely and
        // reseeding the single row — the same recipe
        // `tenantIsolation.integration.test.ts` uses to restore a revoked key,
        // so a reused container is not left holding the duplicate.
        await harness.applyAsAdmin([
          `ALTER TABLE ${database}.${harness.names.keyMapTable} ` +
            `DELETE WHERE KeyHash = '${harness.tenantA.keyHash}' SETTINGS mutations_sync = 2`,
        ]);
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
        tenantA,
        `SELECT count() AS value FROM ${database}.${PG_MAPPED_VIEW}`,
      );
      expect(
        Number(restored),
        "the key map was not restored, later tests would still see the duplicate",
      ).toBe(control.tenantA);
    });
  });
});
