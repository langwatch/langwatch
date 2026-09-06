/**
 * The scan ceilings, as the caller experiences them.
 *
 * `max_rows_to_read` and `max_bytes_to_read` are pinned `CONST` by the settings
 * profile under `read_overflow_mode = 'throw'`, so a query that would read past
 * either is aborted rather than answered with a partial result. What this file
 * proves is the half that lives outside the database: that the abort reaches a
 * caller as the coded `query_scan_limit_exceeded` rather than as an unknown
 * 500. The mapping is unit-tested against synthesised driver errors
 * (`app-layer/clients/clickhouse/__tests__/translate-query-error.unit.test.ts`);
 * only a real server can say whether the codes those fixtures carry are the
 * ones ClickHouse actually raises.
 *
 * Two habits carried over from the isolation proof, both answers to how this
 * kind of test goes vacuous:
 *
 *  - Every rejection is paired with the same query succeeding under the shipped
 *    ceilings. A typo throws too, and would otherwise read as the ceiling
 *    working.
 *  - The ceiling is applied by re-running the *shipped* setup statements with
 *    different limits, not by a hand-written `CREATE SETTINGS PROFILE` — a
 *    proof that transcribes the thing it guards proves the transcription.
 *
 * @see ../provisioning.ts — the profile that pins the ceilings
 * @see specs/analytics/lwql-api.feature
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  type LangWatchQLExecutor,
} from "../executor";
import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
  lwqlClickHouseSetupStatements,
} from "../provisioning";
import {
  type LangWatchQLClickHouseHarness,
  recordSeedControl,
  startLangWatchQLClickHouse,
} from "./lwqlClickHouseHarness";

/**
 * Low enough that the seeded fixture cannot clear it, and stated as 1 rather
 * than 0 — ClickHouse reads 0 as "unlimited", so a ceiling that drifted to zero
 * would silently stop bounding anything.
 */
const TINY_ROW_CEILING = 1;
/** Smaller than a single seeded row, so the byte ceiling bites for certain. */
const TINY_BYTE_CEILING = 1;

/**
 * Reads real rows rather than a count.
 *
 * `SELECT count()` over a `MergeTree` is answered from part metadata without
 * reading rows at all, so it clears any scan ceiling and would report the
 * ceiling as broken.
 */
const SCANNING_QUERY = (database: string) =>
  `SELECT TenantId, TraceId, Model FROM ${database}.traces ORDER BY TraceId`;

describe("given the LangWatchQL settings profile's scan ceilings", () => {
  let harness: LangWatchQLClickHouseHarness;
  let executor: LangWatchQLExecutor;
  let database: string;

  /**
   * Re-provisions the whole access model at `limits`.
   *
   * The full statement list, in its shipped order, rather than the profile
   * statement alone: `CREATE USER OR REPLACE` mints a new access-entity id, so
   * a profile replaced underneath an existing user leaves that user carrying
   * the id of the profile that was replaced — the new ceilings would never
   * apply and the test would report a working ceiling as broken.
   */
  const provisionWith = async (limits: LangWatchQLResourceLimits) => {
    await harness.applyAsAdmin(
      lwqlClickHouseSetupStatements({
        names: harness.names,
        password: harness.restrictedConnection().password,
        lwqlTables: harness.lwqlTables,
        limits,
      }),
    );
  };

  /** Runs `SCANNING_QUERY` as the restricted identity, through the executor. */
  const runLangWatchQLQuery = () =>
    executor.execute({
      sql: SCANNING_QUERY(database),
      tenantCapability: harness.tenantA.keyHash,
      limits: DEFAULT_LWQL_RESULT_LIMITS,
    });

  /** The `code` of whatever the executor threw, or why there is none. */
  const codeOfFailure = async (): Promise<unknown> => {
    try {
      await runLangWatchQLQuery();
    } catch (error) {
      return (error as { code?: unknown }).code;
    }
    return "<the query succeeded, so no ceiling was enforced>";
  };

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "scanceiling" });
    database = harness.names.database;
    executor = createLangWatchQLExecutor({
      ...harness.restrictedConnection(),
      database,
      tenantSetting: harness.names.tenantSetting,
    });
  }, 180_000);

  afterAll(async () => {
    // A `beforeAll` that failed before the harness existed has nothing to
    // restore or stop, and dereferencing it here would mask that startup
    // failure with a TypeError.
    if (!harness) return;
    // The container is reused, so a suite that left a one-row ceiling behind
    // would break whichever suite ran next against it.
    await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);
    await harness.stop();
  });

  describe("when the shipped ceilings are in force", () => {
    /**
     * The control for both rejections below. Without it, "the query failed"
     * is equally satisfied by a query that never worked.
     */
    it("answers the query, over more rows than the tightened ceiling allows", async () => {
      await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const result = await runLangWatchQLQuery();

      expect(result.rows.length).toBe(control.tenantA);
      expect(
        control.tenantA,
        "the fixture holds no more rows than the tightened ceiling, so the rejections below would prove nothing",
      ).toBeGreaterThan(TINY_ROW_CEILING);
    });
  });

  describe("when a query would read past the row ceiling", () => {
    it("fails with the coded scan-limit error rather than an unknown 500", async () => {
      await provisionWith({
        ...DEFAULT_LWQL_RESOURCE_LIMITS,
        maxRowsToRead: TINY_ROW_CEILING,
      });

      // By `code`, never by message: the prose is ClickHouse's and changes with
      // the server version, while the code is the contract the caller branches
      // on.
      expect(await codeOfFailure()).toBe("query_scan_limit_exceeded");
    });
  });

  describe("when a query would read past the byte ceiling", () => {
    /**
     * A separate ClickHouse error code from the row ceiling — 307 rather than
     * 158 — so a translation that handled only one of them would pass the case
     * above and still hand this one to the caller as unknown.
     */
    it("fails with the same coded scan-limit error", async () => {
      await provisionWith({
        ...DEFAULT_LWQL_RESOURCE_LIMITS,
        maxBytesToRead: TINY_BYTE_CEILING,
      });

      expect(await codeOfFailure()).toBe("query_scan_limit_exceeded");
    });
  });
});
