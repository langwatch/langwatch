/**
 * A saved statement that names a column no dataset defines, as the caller
 * experiences it.
 *
 * Save-time validation proves tables and syntax but not column existence —
 * only the database knows that — so this failure can only be named at run
 * time (#7447). What this file proves against a real server: UNKNOWN_IDENTIFIER
 * arrives as the coded `lwql_unknown_identifier`, a caller fault, with the
 * missing names in `meta.identifiers`, while the same-shaped query naming only
 * real columns still runs. The classification and extraction are unit-tested
 * against synthesised driver errors
 * (`app-layer/clients/clickhouse/__tests__/translate-query-error.unit.test.ts`
 * and {@link lwqlUnknownIdentifier.unit.test.ts}); only a real server can say
 * the synthesised shape is what ClickHouse actually raises.
 *
 * Habit carried over from the sibling suite: every refusal is paired with a
 * succeeding query, so a broken executor cannot read as a working mapping.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  type LangWatchQLExecutor,
} from "../executor";
import {
  type LangWatchQLClickHouseHarness,
  recordSeedControl,
  startLangWatchQLClickHouse,
} from "./lwqlClickHouseHarness";

describe("given a statement naming a column no dataset defines", () => {
  let harness: LangWatchQLClickHouseHarness;
  let executor: LangWatchQLExecutor;
  let database: string;

  /** The thrown error itself, or why there is none. */
  const failureOf = async (
    sql: string,
  ): Promise<{ code?: unknown; meta?: unknown } | "<succeeded>"> => {
    try {
      await executor.execute({
        sql,
        tenantCapability: harness.tenantA.keyHash,
        limits: DEFAULT_LWQL_RESULT_LIMITS,
      });
    } catch (error) {
      return error as { code?: unknown; meta?: unknown };
    }
    return "<succeeded>";
  };

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "unknown-identifier" });
    database = harness.names.database;
    executor = createLangWatchQLExecutor({
      ...harness.restrictedConnection(),
      database,
      tenantSetting: harness.names.tenantSetting,
    });
  }, 180_000);

  afterAll(async () => {
    if (!harness) return;
    // The executor owns a connection pool against this server; release it
    // before the container stops, or the sockets outlive the suite.
    await executor.close?.();
    await harness.stop();
  });

  describe("when the query selects a column that does not exist", () => {
    // @scenario "A query naming a column no dataset has fails with a coded, member-actionable error"
    it("fails with lwql_unknown_identifier carrying the missing names", async () => {
      const failure = await failureOf(
        `SELECT TraceId, no_such_column_anywhere FROM ${database}.traces LIMIT 1`,
      );

      expect(failure).not.toBe("<succeeded>");
      const { code, meta } = failure as { code?: unknown; meta?: unknown };
      expect(code).toBe("lwql_unknown_identifier");
      expect(meta).toEqual({ identifiers: ["no_such_column_anywhere"] });
    });

    it("answers the same-shaped query that names only real columns", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const result = await executor.execute({
        sql: `SELECT TraceId FROM ${database}.traces ORDER BY TraceId`,
        tenantCapability: harness.tenantA.keyHash,
        limits: DEFAULT_LWQL_RESULT_LIMITS,
      });

      expect(result.rows.length).toBe(control.tenantA);
    });
  });

  describe("when several named columns are missing", () => {
    // The server reports one identifier per refusal — the first it cannot
    // resolve — so the member fixes one and meets the next on the next run.
    it("names the first unresolvable column", async () => {
      const failure = await failureOf(
        `SELECT missing_b, missing_a FROM ${database}.traces LIMIT 1`,
      );

      expect(failure).not.toBe("<succeeded>");
      const { code, meta } = failure as { code?: unknown; meta?: unknown };
      expect(code).toBe("lwql_unknown_identifier");
      expect(meta).toEqual({ identifiers: ["missing_b"] });
    });
  });
});
