/**
 * The app functions' projection UDFs, against a real ClickHouse.
 *
 * Four claims the validator and the hydrator cannot make on their own, because
 * each is a statement about the *server*:
 *
 *  1. The shipped provisioning statements create the functions, converge on a
 *     re-run, and leave every one of them reported as our own SQL UDF.
 *  2. The restricted identity can *call* one and cannot create, replace, drop
 *     or reload any, and the refusal is an access-control one (497) rather than
 *     a readonly one — so it holds even if `readonly` were ever relaxed.
 *  3. A projection UDF does not widen what a tenant reads: the row policy still
 *     bounds the query it appears in.
 *  4. A statement using one is still recorded verbatim, which is the promise
 *     the whole no-rewriter design rests on (`lwql-api.feature`).
 *
 * Applied from the *shipped* statement list rather than a transcription of it,
 * for the reason the rest of this directory documents: a proof that copies the
 * thing it guards proves the copy.
 *
 * @see ../provisioning/appFunctionStatements.ts
 * @see specs/lwql/app-functions.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lwqlAppFunctionNames } from "../appFunctions/catalog";
import { LWQL_EVAL_FUNCTION_CATALOG } from "../appFunctions/evalCatalog";
import {
  lwqlAppFunctionGrantAuditQuery,
  lwqlClickHouseSetupStatements,
} from "../provisioning/accessModel";
import {
  type LangWatchQLServerFunctionRow,
  LWQL_SQL_UDF_ORIGIN,
  lwqlAppFunctionConflicts,
  lwqlAppFunctionReconciliationQuery,
  lwqlAppFunctionStatements,
} from "../provisioning/appFunctionStatements";
import {
  CLICKHOUSE_ERROR_CODE,
  expectClickHouseError,
  expectOnlyTenantA,
  type LangWatchQLClickHouseHarness,
  runStatement,
  selectRows,
  startLangWatchQLClickHouse,
} from "./lwqlClickHouseHarness";

describe("given the LangWatchQL app functions provisioned on a real server", () => {
  let harness: LangWatchQLClickHouseHarness;
  let tenantA: ClickHouseClient;
  let database: string;

  const serverFunctions = () =>
    selectRows<LangWatchQLServerFunctionRow>(
      harness.admin,
      lwqlAppFunctionReconciliationQuery(),
    );

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "appfunctions" });
    database = harness.names.database;
    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
  }, 180_000);

  afterAll(async () => {
    if (!harness) return;
    await harness.stop();
  });

  describe("when the shipped provisioning statements have been applied", () => {
    /** @scenario "Provisioning the functions twice leaves the same definitions" */
    it("creates every declared function as our own SQL UDF", async () => {
      const rows = await serverFunctions();

      expect(rows.map((row) => row.name).sort()).toEqual(
        [...lwqlAppFunctionNames()].sort(),
      );
      for (const row of rows) {
        expect(row.origin, row.name).toBe(LWQL_SQL_UDF_ORIGIN);
      }
      expect(lwqlAppFunctionConflicts({ rows })).toEqual([]);
    });

    /** @scenario "Provisioning the functions twice leaves the same definitions" */
    it("converges on a second run rather than failing on what is there", async () => {
      await harness.applyAsAdmin(lwqlAppFunctionStatements());

      const rows = await serverFunctions();
      expect(rows).toHaveLength(lwqlAppFunctionNames().length);
      expect(lwqlAppFunctionConflicts({ rows })).toEqual([]);
    });

    it("re-applies the whole access model without a function collision", async () => {
      // The statement list is what a self-provisioning boot runs on every
      // start, so "idempotent" has to mean the whole list, not the function
      // statements on their own.
      await harness.applyAsAdmin(
        lwqlClickHouseSetupStatements({
          names: harness.names,
          password: harness.restrictedConnection().password,
          lwqlTables: harness.lwqlTables,
        }),
      );

      expect(
        lwqlAppFunctionConflicts({ rows: await serverFunctions() }),
      ).toEqual([]);
    });
  });

  describe("when the restricted identity uses a function", () => {
    /** @scenario "The restricted identity may call an app function but never manage one" */
    it("may call one in a projection, and gets its key back", async () => {
      const rows = await selectRows<{ TraceId: string; key: string }>(
        tenantA,
        `SELECT TraceId, llm_readable_trace(TraceId, 8000) AS key ` +
          `FROM ${database}.traces ORDER BY TraceId LIMIT 5`,
      );

      expect(rows.length).toBeGreaterThan(0);
      // The database's half of the contract: the UDF is the identity on its
      // key, so the column carries the trace id and the application is what
      // replaces it. A server that returned anything else would make the
      // hydration stage read a value as a key.
      for (const row of rows) {
        expect(row.key).toBe(row.TraceId);
      }
    });

    /** @scenario "The restricted identity may call an app function but never manage one" */
    it.each([
      ["create", "CREATE FUNCTION lwql_probe AS (k) -> k"],
      ["replace", "CREATE OR REPLACE FUNCTION conversation AS (k) -> 'owned'"],
      ["drop", "DROP FUNCTION conversation"],
      ["reload", "SYSTEM RELOAD FUNCTIONS"],
    ])("may not %s a function", async (_verb, statement) => {
      await expectClickHouseError(
        runStatement(tenantA, statement),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        `the restricted identity must not be able to run: ${statement}`,
      );
    });

    it("holds no function-management grant at all", async () => {
      const grants = await selectRows<{ access_type: string }>(
        harness.admin,
        lwqlAppFunctionGrantAuditQuery({ names: harness.names }),
      );

      expect(grants).toEqual([]);
    });

    it("calls one without any grant on it, which is why none is issued", async () => {
      // The control for the assertion above: with no grant, the call above
      // still worked. Without this pairing, "no grant" would be equally
      // satisfied by a function nobody can call.
      const rows = await selectRows<{ value: string }>(
        tenantA,
        `SELECT conversation('probe') AS value`,
      );

      expect(rows[0]?.value).toBe("probe");
    });
  });

  describe("when a function appears in a tenant-scoped query", () => {
    /** @scenario "An app function does not widen what a tenant can read" */
    it("reads only the calling tenant's rows", async () => {
      const both = await selectRows<{ TenantId: string }>(
        harness.admin,
        `SELECT DISTINCT TenantId FROM ${harness.factDatabase}.traces`,
      );
      // Control: with one tenant's rows only, "no foreign rows" proves nothing.
      expect(
        both.length,
        "the fixture holds one tenant, so the scoping claim below is vacuous",
      ).toBeGreaterThan(1);

      const rows = await selectRows<Record<string, unknown>>(
        tenantA,
        `SELECT TenantId, llm_readable_trace(TraceId, 8000) AS text ` +
          `FROM ${database}.traces ORDER BY TraceId LIMIT 50`,
      );

      expectOnlyTenantA({
        rows,
        tenantColumn: "TenantId",
        harness,
        context: "a projection UDF must not widen the row policy",
      });
    });
  });

  describe("when an eval function is called", () => {
    /** @scenario "The eval functions are provisioned as projection UDFs like every other app function" */
    it("holds one of our own SQL user-defined functions for every declared name", async () => {
      const rows = await serverFunctions();
      const evalNames = LWQL_EVAL_FUNCTION_CATALOG.map(
        (definition) => definition.name,
      );

      expect(evalNames.length).toBeGreaterThan(0);
      for (const name of evalNames) {
        const row = rows.find((candidate) => candidate.name === name);
        expect(row?.origin, name).toBe(LWQL_SQL_UDF_ORIGIN);
      }
    });

    /** @scenario "A statement calling an eval function is recorded verbatim and hands back its text" */
    it("records the statement verbatim and answers with the text it was given", async () => {
      const queryId = `lwql-evalfn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const sql =
        `SELECT TraceId, eval(TraceId, 'The trace failed') AS annoyed ` +
        `/* eval-function-verbatim-marker */ FROM ${database}.traces ORDER BY TraceId LIMIT 3`;

      const rows = await selectRows<{ TraceId: string; annoyed: string }>(
        tenantA,
        sql,
        { query_id: queryId },
      );
      await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);

      expect(rows.length).toBeGreaterThan(0);
      // The database's half: the eval UDF is the identity on the text it was
      // given, so the application receives the text to judge rather than a
      // value the database invented.
      for (const row of rows) expect(row.annoyed).toBe(row.TraceId);

      const entries = await selectRows<{ query: string }>(
        harness.admin,
        `SELECT query FROM system.query_log WHERE query_id = '${queryId}' AND type = 'QueryFinish'`,
      );
      expect(
        entries.length,
        "no query_log entry for the audited query — the verbatim claim would be vacuous",
      ).toBeGreaterThan(0);
      for (const entry of entries) expect(entry.query).toContain(sql);
    });
  });

  describe("when the server's query log is inspected", () => {
    /** @scenario "Submitted SQL using an app function is still recorded verbatim" */
    it("holds the submitted statement byte for byte, comment included", async () => {
      const queryId = `lwql-appfn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const sql =
        `SELECT TraceId, llm_readable_trace(TraceId, 8000) AS text ` +
        `/* app-function-verbatim-marker */ FROM ${database}.traces ORDER BY TraceId LIMIT 3`;

      await selectRows(tenantA, sql, { query_id: queryId });
      await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);

      const entries = await selectRows<{ query: string }>(
        harness.admin,
        `SELECT query FROM system.query_log WHERE query_id = '${queryId}' AND type = 'QueryFinish'`,
      );

      // A missing row must fail: otherwise "the text was not rewritten" is
      // satisfied by there being nothing to compare.
      expect(
        entries.length,
        "no query_log entry for the audited query — the verbatim claim would be vacuous",
      ).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.query).toContain(sql);
      }
    });
  });
});
