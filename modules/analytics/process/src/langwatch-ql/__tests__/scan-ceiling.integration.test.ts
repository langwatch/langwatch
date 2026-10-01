/**
 * The profile's read and result ceilings, as the caller experiences them: a coded refusal, never
 * a raw driver error. Every rejection is paired with the same shape succeeding, and the ceiling
 * is applied by re-running the shipped setup statements, never a hand-written profile.
 * @see specs/lwql/result-paging.feature
 */

import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "@langwatch/analytics-contract/langwatch-ql-limits";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import type { LangWatchQLExecutorRepository } from "../../repositories/langwatch-ql-executor.repository.ts";
import {
  type LangWatchQLClickHouseHarness,
  recordSeedControl,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

/** 1 rather than 0: ClickHouse reads 0 as "unlimited". */
const TINY_CEILING = 1;

/** Reads real rows: `count()` over a MergeTree is answered from part metadata. */
const scanningQuery = (database: string) =>
  `SELECT TenantId, TraceId, Model FROM ${database}.traces ORDER BY TraceId`;

/** A `LIMIT` the static validator cannot read, so it passes `LIMIT_TOO_HIGH` and the append. */
const parameterisedLimitQuery = (database: string) =>
  `SELECT TenantId, TraceId, Model FROM ${database}.traces LIMIT {n:UInt64}`;

/** Comfortably above the shipped `max_result_rows` (10,000). */
const ROW_COUNT = 10_010;

describe("given the LangWatchQL settings profile's ceilings", () => {
  let harness: LangWatchQLClickHouseHarness;
  let executor: LangWatchQLExecutorRepository;
  let database: string;

  /** The full statement list: `CREATE USER OR REPLACE` would orphan a lone replaced profile. */
  const provisionWith = async (limits: LangWatchQLResourceLimits) => {
    await harness.applyAccessModel({ limits });
  };

  const run = ({ sql, parameters }: { sql: string; parameters?: Record<string, unknown> }) =>
    executor.execute({
      sql,
      parameters,
      tenantCapability: harness.tenantA.keyHash,
    });

  const codeOfFailure = async (attempt: () => Promise<unknown>): Promise<unknown> => {
    try {
      await attempt();
    } catch (error) {
      return (error as { code?: unknown }).code;
    }
    return "<the query succeeded, so no ceiling was enforced>";
  };

  const tenantARows = async () =>
    (await recordSeedControl({ harness, table: "traces", tenantColumn: "TenantId" })).tenantA;

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "scanceiling" });
    database = harness.names.database;
    executor = ClickHouseLangWatchQLExecutorRepository.create({
      connection: {
        ...harness.restrictedConnection(),
        database,
        tenantSetting: harness.names.tenantSetting,
      },
    });
  }, 180_000);

  afterAll(async () => {
    if (!harness) return;
    // The container is reused; a one-row ceiling left behind breaks the next suite.
    await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);
    await harness.stop();
  });

  describe("when the shipped ceilings are in force", () => {
    it("answers the query, over more rows than the tightened ceilings allow", async () => {
      await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);
      const expected = await tenantARows();

      const result = await run({ sql: scanningQuery(database) });

      expect(result.rows.length).toBe(expected);
      expect(expected).toBeGreaterThan(TINY_CEILING);
    });
  });

  describe("when a query would read past the row ceiling", () => {
    it("fails with the coded scan-limit error rather than an unknown 500", async () => {
      await provisionWith({ ...DEFAULT_LWQL_RESOURCE_LIMITS, maxRowsToRead: TINY_CEILING });

      expect(await codeOfFailure(() => run({ sql: scanningQuery(database) }))).toBe(
        "query_scan_limit_exceeded",
      );
    });
  });

  describe("when a query would read past the byte ceiling", () => {
    it("fails with the same coded scan-limit error", async () => {
      await provisionWith({ ...DEFAULT_LWQL_RESOURCE_LIMITS, maxBytesToRead: TINY_CEILING });

      expect(await codeOfFailure(() => run({ sql: scanningQuery(database) }))).toBe(
        "query_scan_limit_exceeded",
      );
    });
  });

  describe("when a query's LIMIT is a bound parameter above the result ceiling", () => {
    it("answers the query when the ceiling is not tightened", async () => {
      await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);
      const n = await tenantARows();

      const result = await run({ sql: parameterisedLimitQuery(database), parameters: { n } });

      expect(result.rows.length).toBe(n);
      expect(n).toBeGreaterThan(TINY_CEILING);
    });

    /** @scenario "A parameterised LIMIT cannot outrun the server-side ceiling" */
    it("fails with lwql_result_too_large rather than a raw driver error", async () => {
      await provisionWith({ ...DEFAULT_LWQL_RESOURCE_LIMITS, maxResultRows: TINY_CEILING });
      const n = await tenantARows();

      expect(
        await codeOfFailure(() =>
          run({ sql: parameterisedLimitQuery(database), parameters: { n } }),
        ),
      ).toBe("lwql_result_too_large");
    });
  });

  describe("when a query's own clause does not bound its total output", () => {
    describe("and it names only an OFFSET", () => {
      it("answers a shape that stays within the ceiling", async () => {
        await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);

        const result = await run({ sql: "SELECT number FROM numbers(5) ORDER BY number OFFSET 2" });

        expect(result.rows.length).toBe(3);
      });

      /** @scenario "An OFFSET with no LIMIT cannot outrun the server-side ceiling" */
      it("fails with lwql_result_too_large rather than a raw driver error", async () => {
        await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);

        const sql = `SELECT number FROM numbers(${ROW_COUNT}) ORDER BY number OFFSET 5`;
        expect(await codeOfFailure(() => run({ sql }))).toBe("lwql_result_too_large");
      });
    });

    describe("and its only LIMIT clause is a LIMIT BY", () => {
      it("answers a shape that stays within the ceiling", async () => {
        await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);

        const result = await run({
          sql: "SELECT number FROM numbers(5) ORDER BY number LIMIT 1 BY number",
        });

        expect(result.rows.length).toBe(5);
      });

      /** @scenario "A LIMIT BY clause cannot outrun the server-side ceiling" */
      it("fails with lwql_result_too_large rather than a raw driver error", async () => {
        await provisionWith(DEFAULT_LWQL_RESOURCE_LIMITS);

        const sql = `SELECT number FROM numbers(${ROW_COUNT}) ORDER BY number LIMIT 1 BY number`;
        expect(await codeOfFailure(() => run({ sql }))).toBe("lwql_result_too_large");
      });
    });
  });
});
