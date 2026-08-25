/**
 * A half-provisioned deployment, as the caller experiences it.
 *
 * The catalog promises datasets; provisioning is what makes them real. When
 * the two disagree — a view was never created, or it exists but the restricted
 * identity was never granted onto it — the server refuses with UNKNOWN_TABLE
 * or ACCESS_DENIED, and before this mapping existed that refusal reached the
 * caller as an unknown 500 indistinguishable from a crash. What this file
 * proves is that against a real server both refusals arrive as the coded
 * `lwql_unavailable` instead. The classification itself is unit-tested against
 * synthesised driver errors
 * (`app-layer/clients/clickhouse/__tests__/translate-query-error.unit.test.ts`);
 * only a real server can say the codes those fixtures carry are the ones
 * ClickHouse actually raises here.
 *
 * Two habits carried over from the sibling suites:
 *
 *  - Every rejection is paired with the same-shaped query succeeding on a
 *    provisioned table. A typo throws too, and would otherwise read as the
 *    mapping working.
 *  - The ungranted case creates a real table and withholds only the grant, so
 *    what is proven is the grant's absence — not the table's.
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

/** Exists only as a name — never created, in any suite's database. */
const NEVER_CREATED_TABLE = "unprovisioned_probe_view";
/** Created by the administrator below, deliberately never granted. */
const UNGRANTED_TABLE = "ungranted_probe_table";

describe("given a deployment whose LangWatchQL objects are incomplete", () => {
  let harness: LangWatchQLClickHouseHarness;
  let executor: LangWatchQLExecutor;
  let database: string;

  /** The `code` of whatever the executor threw, or why there is none. */
  const codeOfFailure = async (sql: string): Promise<unknown> => {
    try {
      await executor.execute({
        sql,
        tenantCapability: harness.tenantA.keyHash,
        limits: DEFAULT_LWQL_RESULT_LIMITS,
      });
    } catch (error) {
      return (error as { code?: unknown }).code;
    }
    return "<the query succeeded, so nothing was refused>";
  };

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "unprovisioned" });
    database = harness.names.database;
    executor = createLangWatchQLExecutor({
      ...harness.restrictedConnection(),
      database,
      tenantSetting: harness.names.tenantSetting,
    });
    await harness.applyAsAdmin([
      `CREATE TABLE ${database}.${UNGRANTED_TABLE} (Probe UInt8) ENGINE = MergeTree ORDER BY Probe`,
    ]);
  }, 180_000);

  afterAll(async () => {
    // A `beforeAll` that failed before the harness existed has nothing to
    // restore or stop, and dereferencing it here would mask that startup
    // failure with a TypeError.
    if (!harness) return;
    // The container is reused, so a suite that left its probe table behind
    // would surprise whichever suite ran next against it.
    await harness.applyAsAdmin([`DROP TABLE IF EXISTS ${database}.${UNGRANTED_TABLE}`]);
    await harness.stop();
  });

  describe("when the same-shaped query names a provisioned table", () => {
    /**
     * The control for both rejections below. Without it, "the query failed"
     * is equally satisfied by an executor that never worked.
     */
    it("answers it", async () => {
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

  describe("when the query names a table that was never created", () => {
    it("fails with the coded lwql_unavailable rather than an unknown 500", async () => {
      // By `code`, never by message: the prose is ClickHouse's and changes
      // with the server version, while the code is the contract the caller
      // branches on.
      expect(
        await codeOfFailure(
          `SELECT Probe FROM ${database}.${NEVER_CREATED_TABLE} LIMIT 1`,
        ),
      ).toBe("lwql_unavailable");
    });
  });

  describe("when the table exists but the restricted identity holds no grant", () => {
    /**
     * A separate ClickHouse refusal from the missing table — ACCESS_DENIED
     * rather than UNKNOWN_TABLE — so a mapping that handled only one of them
     * would pass the case above and still hand this one to the caller as
     * unknown.
     */
    it("fails with the same coded lwql_unavailable", async () => {
      expect(
        await codeOfFailure(`SELECT Probe FROM ${database}.${UNGRANTED_TABLE} LIMIT 1`),
      ).toBe("lwql_unavailable");
    });
  });
});
