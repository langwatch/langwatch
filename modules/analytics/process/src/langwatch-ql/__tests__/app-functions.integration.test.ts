/**
 * The app functions' projection UDFs against a real ClickHouse: the shipped
 * statements create and converge, the restricted identity may call but never
 * manage one, a call never widens the row policy, and the SQL stays verbatim.
 * @see specs/lwql/app-functions.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lwqlAppFunctionNames } from "../../rules/langwatch-ql-app-function-catalog.rules.ts";
import { LWQL_EVAL_FUNCTION_CATALOG } from "../../rules/langwatch-ql-eval-function-catalog.rules.ts";
import { LangWatchQLAccessAuditService } from "../../services/langwatch-ql-access-audit.service.ts";
import { LangWatchQLAccessModelService } from "../../services/langwatch-ql-access-model.service.ts";
import {
  type LangWatchQLServerFunctionRow,
  LangWatchQLAppFunctionStatementsService,
  LWQL_SQL_UDF_ORIGIN,
} from "../../services/langwatch-ql-app-function-statements.service.ts";
import {
  CLICKHOUSE_ERROR_CODE,
  expectClickHouseError,
  expectOnlyTenantA,
  type LangWatchQLClickHouseHarness,
  runStatement,
  selectRows,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

const statements = LangWatchQLAppFunctionStatementsService.create();
const accessModel = LangWatchQLAccessModelService.create();
const accessAudit = LangWatchQLAccessAuditService.create();

describe("given the LangWatchQL app functions provisioned on a real server", () => {
  let harness: LangWatchQLClickHouseHarness;
  let tenantA: ClickHouseClient;
  let database: string;

  const serverFunctions = () =>
    selectRows<LangWatchQLServerFunctionRow>(harness.admin, statements.reconciliationQuery());

  /** Runs a statement as tenant A under a known query id, then reads what the server logged. */
  const loggedQueries = async ({ sql, marker }: { sql: string; marker: string }) => {
    const queryId = `lwql-${marker}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rows = await selectRows<Record<string, string>>(tenantA, sql, { query_id: queryId });
    await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);
    const entries = await selectRows<{ query: string }>(
      harness.admin,
      `SELECT query FROM system.query_log WHERE query_id = '${queryId}' AND type = 'QueryFinish'`,
    );

    return { rows, entries };
  };

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "appfunctions" });
    database = harness.names.database;
    tenantA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });
  }, 180_000);

  afterAll(async () => {
    if (!harness) return;
    await harness.stop();
  });

  describe("when the shipped provisioning statements have been applied", () => {
    /** @scenario "Provisioning the functions twice leaves the same definitions" */
    it("creates every declared function as our own SQL UDF", async () => {
      const rows = await serverFunctions();

      expect(rows.map((row) => row.name).toSorted()).toEqual(lwqlAppFunctionNames().toSorted());
      for (const row of rows) expect(row.origin, row.name).toBe(LWQL_SQL_UDF_ORIGIN);
      expect(statements.findConflicts({ rows })).toEqual([]);
    });

    /** @scenario "Provisioning the functions twice leaves the same definitions" */
    it("converges on a second run rather than failing on what is there", async () => {
      await harness.applyAsAdmin(statements.functionStatements());

      const rows = await serverFunctions();
      expect(rows).toHaveLength(lwqlAppFunctionNames().length);
      expect(statements.findConflicts({ rows })).toEqual([]);
    });

    it("re-applies the whole access model without a function collision", async () => {
      await harness.applyAsAdmin(accessModel.setupStatements({ names: harness.names }));

      expect(statements.findConflicts({ rows: await serverFunctions() })).toEqual([]);
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
      // The UDF is the identity on its key; the application replaces it.
      for (const row of rows) expect(row.key).toBe(row.TraceId);
    });

    /** @scenario "The restricted identity may call an app function but never manage one" */
    it.each([
      ["create", "CREATE FUNCTION lwql_probe AS (k) -> k"],
      ["replace", "CREATE OR REPLACE FUNCTION conversation AS (k) -> 'owned'"],
      ["drop", "DROP FUNCTION conversation"],
      ["reload", "SYSTEM RELOAD FUNCTIONS"],
    ])("may not %s a function", async (_verb, statement) => {
      expect.hasAssertions();
      await expectClickHouseError(
        runStatement(tenantA, statement),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        `the restricted identity must not be able to run: ${statement}`,
      );
    });

    it("holds no function-management grant at all", async () => {
      const grants = await selectRows<{ access_type: string }>(
        harness.admin,
        accessAudit.appFunctionGrantAuditQuery({ names: harness.names }),
      );

      expect(grants).toEqual([]);
    });

    it("calls one without any grant on it, which is why none is issued", async () => {
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
      const evalNames = LWQL_EVAL_FUNCTION_CATALOG.map((definition) => definition.name);

      expect(evalNames.length).toBeGreaterThan(0);
      for (const name of evalNames) {
        expect(rows.find((candidate) => candidate.name === name)?.origin, name).toBe(
          LWQL_SQL_UDF_ORIGIN,
        );
      }
    });

    /** @scenario "A statement calling an eval function is recorded verbatim and hands back its text" */
    it("records the statement verbatim and answers with the text it was given", async () => {
      const sql =
        `SELECT TraceId, eval(TraceId, 'The trace failed') AS annoyed ` +
        `/* eval-function-verbatim-marker */ FROM ${database}.traces ORDER BY TraceId LIMIT 3`;

      const { rows, entries } = await loggedQueries({ sql, marker: "evalfn" });

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.annoyed).toBe(row.TraceId);
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
      const sql =
        `SELECT TraceId, llm_readable_trace(TraceId, 8000) AS text ` +
        `/* app-function-verbatim-marker */ FROM ${database}.traces ORDER BY TraceId LIMIT 3`;

      const { entries } = await loggedQueries({ sql, marker: "appfn" });

      expect(
        entries.length,
        "no query_log entry for the audited query — the verbatim claim would be vacuous",
      ).toBeGreaterThan(0);
      for (const entry of entries) expect(entry.query).toContain(sql);
    });
  });
});
