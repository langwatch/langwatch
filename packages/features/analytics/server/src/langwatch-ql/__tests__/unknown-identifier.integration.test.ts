/**
 * A column that does not exist, as the member who wrote the SQL experiences it.
 *
 * Naming a nonexistent column is the one refusal on this path the caller fixes
 * themselves, and it cannot be caught earlier: the validator approves table
 * names, not columns, and whether a column exists is not knowable when a chart
 * is saved. Before this mapping it reached the caller as an unknown 500: the
 * dashboard widget rendered "Something went wrong" and `langwatch chart run`
 * said "An unknown error occurred", for a typo (#7447).
 *
 * **Why this suite has to touch a real server.** The classification is unit
 * tested against synthesised driver errors
 * (`app-layer/clients/clickhouse/__tests__/translate-query-error.unit.test.ts`),
 * but those fixtures carry the sentences *I* believe ClickHouse writes. The
 * identifier is lifted out of that sentence by a regex, so a fixture-only test
 * proves the regex matches my own fixture and nothing about the engine. Only a
 * real server can say the wording is what the extractor reads, and only a real
 * server catches it changing under an upgrade.
 *
 * Habit carried from the sibling suites: the rejection is paired with the
 * same-shaped query succeeding on a real column. A typo in the test throws
 * too, and would otherwise read as the mapping working.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  type LangWatchQLExecutor,
} from "../executor";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness";

/** A name no dataset carries, distinctive enough to find in a failure. */
const MISSING_COLUMN = "trace_idd_typo";

describe("given SQL that names a column no dataset has", () => {
  let harness: LangWatchQLClickHouseHarness;
  let executor: LangWatchQLExecutor;
  let database: string;

  /** Whatever the executor threw, or a sentence saying it threw nothing. */
  const failureOf = async (sql: string): Promise<unknown> => {
    try {
      await executor.execute({
        sql,
        tenantCapability: harness.tenantA.keyHash,
        limits: DEFAULT_LWQL_RESULT_LIMITS,
      });
    } catch (error) {
      return error;
    }
    return "<the query succeeded, so nothing was refused>";
  };

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "unknownidentifier" });
    database = harness.names.database;
    executor = createLangWatchQLExecutor({
      ...harness.restrictedConnection(),
      database,
      tenantSetting: harness.names.tenantSetting,
    });
  }, 180_000);

  afterAll(async () => {
    // A `beforeAll` that failed before the harness existed has nothing to
    // stop, and dereferencing it would mask that startup failure.
    if (!harness) return;
    await harness.stop();
  });

  describe("when the same-shaped query names a column that exists", () => {
    /**
     * The control. Without it, "the query was refused" is equally satisfied by
     * an executor that never worked, or by a table name the validator rejects.
     */
    it("answers it", async () => {
      const result = await executor.execute({
        sql: `SELECT TraceId FROM ${database}.traces LIMIT 1`,
        tenantCapability: harness.tenantA.keyHash,
        limits: DEFAULT_LWQL_RESULT_LIMITS,
      });

      expect(result.columns.map((column) => column.name)).toEqual(["TraceId"]);
    });
  });

  describe("when the query names a column that does not exist", () => {
    /** @scenario "A query naming a column that does not exist is refused with the column named" */
    it("refuses it as a member-actionable error rather than an unknown", async () => {
      const failure = await failureOf(
        `SELECT ${MISSING_COLUMN} FROM ${database}.traces LIMIT 1`,
      );

      expect((failure as { code?: unknown }).code).toBe(
        "lwql_unknown_identifier",
      );
    });

    /** @scenario "A query naming a column that does not exist is refused with the column named" */
    it("blames the member rather than the platform", async () => {
      const failure = await failureOf(
        `SELECT ${MISSING_COLUMN} FROM ${database}.traces LIMIT 1`,
      );
      const serialised = (
        failure as { serialize: () => Record<string, unknown> }
      ).serialize();

      // `fault` is what decides whether this pages someone. A typo must not.
      expect(serialised.fault).toBe("customer");
    });

    /**
     * The assertion this whole suite exists for. Everything above would still
     * pass if the extractor read nothing out of the server's sentence, because
     * the identifier is optional by design. This is what says the wording the
     * unit fixtures assume is the wording ClickHouse actually writes.
     *
     * @scenario "A query naming a column that does not exist is refused with the column named"
     */
    it("names the offending column, read from what the server actually said", async () => {
      const failure = await failureOf(
        `SELECT ${MISSING_COLUMN} FROM ${database}.traces LIMIT 1`,
      );
      const serialised = (
        failure as { serialize: () => Record<string, unknown> }
      ).serialize();

      expect(serialised.meta).toMatchObject({ identifier: MISSING_COLUMN });
    });

    /** @scenario "A query naming a column that does not exist is refused with the column named" */
    it("relays no part of the server's message, which echoes the query", async () => {
      const failure = await failureOf(
        `SELECT ${MISSING_COLUMN} FROM ${database}.traces LIMIT 1`,
      );
      const serialised = (
        failure as { serialize: () => Record<string, unknown> }
      ).serialize();

      // The raw refusal rides in `reasons` for the operator's logs. What a
      // caller receives is the code, the copy, and the one identifier.
      const wire = JSON.stringify({
        code: serialised.code,
        message: serialised.message,
        meta: serialised.meta,
        tips: serialised.tips,
      });

      expect(wire).not.toContain("DB::Exception");
      expect(wire).not.toContain(database);
      expect(wire).not.toContain("SELECT");
    });
  });
});
