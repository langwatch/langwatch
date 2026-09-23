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
 * @see ../provisioning/accessModel.ts — the profile that pins the ceilings
 * @see specs/lwql/api.feature
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLangWatchQLExecutor,
  type LangWatchQLExecutor,
} from "../executor";
import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "../limits";
import {
  type LangWatchQLClickHouseHarness,
  lwqlHarnessAccessModelStatements,
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

/**
 * Above {@link TINY_RESULT_ROW_CEILING} but not a static value the validator
 * could refuse — a `LIMIT` written as a bound parameter, exactly the shape
 * that evades the TypeScript-side `LIMIT_TOO_HIGH` check.
 */
const PARAMETERISED_LIMIT_QUERY = (database: string) =>
  `SELECT TenantId, TraceId, Model FROM ${database}.traces LIMIT {n:UInt64}`;

/** Small enough that the seeded fixture clears it, cheaply. */
const TINY_RESULT_ROW_CEILING = 1;

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
    // Re-render the access model from the definition with the new limits: the
    // settings profile carries the ceiling under test, and the ordered
    // profile→user→policies→grants render converges it without stranding the
    // user on a replaced profile id.
    await harness.applyAsAdmin(
      lwqlHarnessAccessModelStatements({ harness, limits }),
    );
  };

  /** Runs `SCANNING_QUERY` as the restricted identity, through the executor. */
  const runLangWatchQLQuery = () =>
    executor.execute({
      sql: SCANNING_QUERY(database),
      tenantCapability: harness.tenantA.keyHash,
    });

  /** The `code` of whatever the executor threw, or why there is none. */
  const codeOfFailure = async (
    run: () => Promise<unknown> = runLangWatchQLQuery,
  ): Promise<unknown> => {
    try {
      await run();
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

  /**
   * The validator's `LIMIT_TOO_HIGH` check only reads a static integer
   * literal — a `LIMIT` supplied as a bound parameter is not a value it can
   * see, so it passes both that refusal and the append decision. This is the
   * server-side backstop for exactly that gap: `max_result_rows` /
   * `max_result_bytes` under `result_overflow_mode = 'throw'`, pinned `CONST`
   * by the same settings profile as the scan ceilings above.
   */
  describe("when a query's LIMIT is a bound parameter above the result ceiling", () => {
    afterAll(async () => {
      await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);
    });

    it("answers the query when the ceiling is not tightened", async () => {
      await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const result = await executor.execute({
        sql: PARAMETERISED_LIMIT_QUERY(database),
        parameters: { n: control.tenantA },
        tenantCapability: harness.tenantA.keyHash,
      });

      expect(result.rows.length).toBe(control.tenantA);
      expect(
        control.tenantA,
        "the fixture holds no more rows than the tightened ceiling, so the rejection below would prove nothing",
      ).toBeGreaterThan(TINY_RESULT_ROW_CEILING);
    });

    /** @scenario "A parameterised LIMIT cannot outrun the server-side ceiling" */
    it("fails with lwql_result_too_large rather than a raw driver error", async () => {
      await provisionWith({
        ...DEFAULT_LWQL_RESOURCE_LIMITS,
        maxResultRows: TINY_RESULT_ROW_CEILING,
      });
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      expect(
        await codeOfFailure(() =>
          executor.execute({
            sql: PARAMETERISED_LIMIT_QUERY(database),
            parameters: { n: control.tenantA },
            tenantCapability: harness.tenantA.keyHash,
          }),
        ),
      ).toBe("lwql_result_too_large");
    });
  });

  /**
   * `numbers(n)` rather than a seeded fact table: the restricted identity is
   * already proven to reach it in `tenantIsolation.integration.test.ts`
   * ("still allows the table functions that read no data"), it reads no
   * tenant data, and it is exactly as many distinct rows as asked for — the
   * cheapest way to put more than {@link LWQL_MAX_RESULT_ROWS} rows in front
   * of the *shipped* ceiling, with nothing tightened.
   *
   * Both statements bypass the TypeScript-side default-`LIMIT` append (this
   * suite talks to `executor.execute` directly, never through
   * `LangWatchQLService`), which is exactly the gap `561a7de247` closed —
   * this proves the server-side `max_result_rows` backstop still catches
   * these two shapes even when nothing upstream does.
   */
  describe("when a query's own clause does not bound its total output", () => {
    /** Comfortably above the shipped `max_result_rows` (10,000). */
    const ROW_COUNT = 10_010;

    afterAll(async () => {
      await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);
    });

    describe("and it names only an OFFSET", () => {
      /**
       * `OFFSET 5` with no `LIMIT` still returns every remaining row — 10,005
       * of them here — so this is the query the append-before-OFFSET logic
       * exists to bound; run raw, it must still be refused.
       */
      const OFFSET_ONLY_QUERY = `SELECT number FROM numbers(${ROW_COUNT}) ORDER BY number OFFSET 5`;

      it("answers a shape that stays within the ceiling", async () => {
        await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);

        const result = await executor.execute({
          sql: `SELECT number FROM numbers(5) ORDER BY number OFFSET 2`,
          tenantCapability: harness.tenantA.keyHash,
        });

        expect(result.rows.length).toBe(3);
      });

      /** @scenario "An OFFSET with no LIMIT cannot outrun the server-side ceiling" */
      it("fails with lwql_result_too_large rather than a raw driver error", async () => {
        await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);

        expect(
          await codeOfFailure(() =>
            executor.execute({
              sql: OFFSET_ONLY_QUERY,
              tenantCapability: harness.tenantA.keyHash,
            }),
          ),
        ).toBe("lwql_result_too_large");
      });
    });

    describe("and its only LIMIT clause is a LIMIT BY", () => {
      /**
       * `LIMIT 1 BY number` bounds rows *per group*, never the statement's
       * total output — every `number` here is its own group, so this still
       * returns all 10,010 rows.
       */
      const LIMIT_BY_ONLY_QUERY = `SELECT number FROM numbers(${ROW_COUNT}) ORDER BY number LIMIT 1 BY number`;

      it("answers a shape that stays within the ceiling", async () => {
        await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);

        const result = await executor.execute({
          sql: `SELECT number FROM numbers(5) ORDER BY number LIMIT 1 BY number`,
          tenantCapability: harness.tenantA.keyHash,
        });

        expect(result.rows.length).toBe(5);
      });

      /** @scenario "A LIMIT BY clause cannot outrun the server-side ceiling" */
      it("fails with lwql_result_too_large rather than a raw driver error", async () => {
        await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);

        expect(
          await codeOfFailure(() =>
            executor.execute({
              sql: LIMIT_BY_ONLY_QUERY,
              tenantCapability: harness.tenantA.keyHash,
            }),
          ),
        ).toBe("lwql_result_too_large");
      });
    });
  });
});
