/**
 * The governed SQL service: what it refuses, what it forwards, and what it
 * never touches.
 *
 * A fake executor rather than a mock, because the interesting claims are about
 * *what reached the database* — the statement, the tenant capability, the fact
 * that nothing reached it at all — and those are artifacts to inspect, not call
 * sequences to verify. The fake records; the tests read the record.
 *
 * The capping the executor itself does is asserted against
 * {@link applyGovernedResultLimits} directly, because a fake that implemented
 * its own truncation would prove only that the fake truncates.
 *
 * @see specs/analytics/governed-sql-api.feature
 */

import { describe, expect, it } from "vitest";

import type { Protections } from "../../../traces/protections";
import { GOVERNED_VIEW_CATALOG } from "../catalog/governedViews";
import {
  applyGovernedResultLimits,
  type GovernedSqlExecutionRequest,
  type GovernedSqlExecutionResult,
  type GovernedSqlExecutor,
} from "../executor";
import { GovernedSqlService } from "../governedSql.service";
import {
  GATED_DATASET,
  GATED_DATASET_QUALIFIED_NAME,
} from "./gatedDatasetFixture";

const DATABASE = "analytics";

const PROJECT = {
  id: "project-under-test",
  apiKey: "sk-lw-governed-sql-service-unit-test-key",
};

/** Everything visible: the caller the gate is measured against. */
const FULLY_PERMITTED: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

/** No captured content, costs allowed — the shape a `restrict` policy produces. */
const WITHOUT_CONTENT: Protections = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
  canSeeCosts: true,
};

/**
 * A query that earns no diagnostic: one dataset, bounded on its time column.
 *
 * Spelled out rather than left as `SELECT count() FROM analytics.traces`,
 * because that shape is *not* clean — reading a dataset with no predicate on
 * its partitioning column is exactly what `UNBOUNDED_TIME_RANGE` reports, and a
 * case asserting "no diagnostics" over it would be asserting the rule is off.
 */
const BOUNDED_COUNT =
  "SELECT count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-01 00:00:00', 3)";

interface RecordingExecutor extends GovernedSqlExecutor {
  readonly calls: GovernedSqlExecutionRequest[];
}

function recordingExecutor(
  result: Partial<GovernedSqlExecutionResult> = {},
): RecordingExecutor {
  const calls: GovernedSqlExecutionRequest[] = [];
  return {
    calls,
    async execute(request) {
      calls.push(request);
      return {
        columns: [{ name: "value", type: "UInt64" }],
        rows: [{ value: 1 }],
        truncated: false,
        statistics: {
          elapsedMs: 3,
          rowsRead: 10,
          bytesRead: 100,
          rowsReturned: 1,
        },
        ...result,
      };
    },
  };
}

function serviceWith(executor: GovernedSqlExecutor | null): GovernedSqlService {
  return new GovernedSqlService({ executor, database: DATABASE });
}

/** The `code` of a thrown handled error, or the reason there is none. */
async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return "<no error was thrown>";
}

/** The `meta` of a thrown handled error. */
async function metaOf(
  run: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    await run();
  } catch (error) {
    return ((error as { meta?: Record<string, unknown> }).meta ?? {}) as Record<
      string,
      unknown
    >;
  }
  return {};
}

describe("given the governed SQL service", () => {
  describe("when a permitted query is submitted", () => {
    it("hands the executor the submitted statement, byte for byte", async () => {
      const executor = recordingExecutor();
      const sql =
        "SELECT   TraceId,\n  count() AS n\nFROM analytics.traces\nGROUP BY TraceId";

      await serviceWith(executor).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql,
      });

      expect(executor.calls).toHaveLength(1);
      expect(executor.calls[0]!.sql).toBe(sql);
    });

    it("carries the project's key digest as the tenant capability", async () => {
      const executor = recordingExecutor();

      await serviceWith(executor).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql: "SELECT count() FROM analytics.traces",
      });

      // Written out rather than recomputed here. Re-deriving the expectation
      // through the same algorithm the service uses would agree with it after
      // any change to that algorithm, so the digest the key map is provisioned
      // against is stated as a constant instead.
      expect(executor.calls[0]!.tenantCapability).toBe(
        "fc9673013bca53b035b608d7d0179f7998f313061274826407da7c49010d6ccd",
      );
      // The raw key is the secret the digest exists to keep out of the
      // database; a capability that merely contained it would be a leak.
      expect(executor.calls[0]!.tenantCapability).not.toContain(PROJECT.apiKey);
    });

    it("returns the executor's typed columns, rows and statistics with no diagnostics", async () => {
      const result = await serviceWith(recordingExecutor()).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql: BOUNDED_COUNT,
      });

      expect(result.columns).toEqual([{ name: "value", type: "UInt64" }]);
      expect(result.rows).toEqual([{ value: 1 }]);
      expect(result.statistics.rowsRead).toBe(10);
      expect(result.truncated).toBe(false);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("when the executor reports the result was cut short", () => {
    it("marks truncation and carries a diagnostic naming the ceiling", async () => {
      const result = await serviceWith(
        recordingExecutor({ truncated: true }),
      ).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql:
          "SELECT TraceId FROM analytics.traces " +
          "WHERE OccurredAt >= toDateTime64('2026-02-01 00:00:00', 3)",
      });

      expect(result.truncated).toBe(true);
      expect(result.diagnostics.map((entry) => entry.code)).toEqual([
        "RESULT_TRUNCATED",
      ]);
      expect(result.diagnostics[0]!.meta).toMatchObject({ maxRows: 10_000 });
    });
  });

  describe("when the policy refuses the query", () => {
    it("refuses a statement that is not a single read", async () => {
      const executor = recordingExecutor();
      const service = serviceWith(executor);

      expect(
        await codeOf(() =>
          service.execute({
            project: PROJECT,
            protections: FULLY_PERMITTED,
            sql: "INSERT INTO analytics.traces VALUES (1)",
          }),
        ),
      ).toBe("governed_sql_not_permitted");
      expect(
        executor.calls,
        "a refused query reached the database",
      ).toHaveLength(0);
    });

    it("refuses a table outside the catalog and a reserved schema", async () => {
      const service = serviceWith(recordingExecutor());

      for (const sql of [
        "SELECT * FROM analytics.trace_summaries",
        "SELECT * FROM system.users",
      ]) {
        expect(
          await codeOf(() =>
            service.execute({
              project: PROJECT,
              protections: FULLY_PERMITTED,
              sql,
            }),
          ),
          sql,
        ).toBe("governed_sql_not_permitted");
      }
    });

    it("reports unparseable text separately from a refused construct", async () => {
      const service = serviceWith(recordingExecutor());

      expect(
        await codeOf(() =>
          service.execute({
            project: PROJECT,
            protections: FULLY_PERMITTED,
            sql: "SELECT FROM WHERE )(",
          }),
        ),
      ).toBe("governed_sql_unparseable");
    });

    it("carries every violation in meta so an agent can fix them in one pass", async () => {
      const meta = await metaOf(() =>
        serviceWith(recordingExecutor()).execute({
          project: PROJECT,
          protections: FULLY_PERMITTED,
          sql: "SELECT * FROM analytics.nowhere SETTINGS max_threads = 1",
        }),
      );

      const violations = meta.violations as { code: string }[];
      expect(violations.map((violation) => violation.code).sort()).toEqual([
        "SETTINGS_CLAUSE",
        "TABLE_NOT_ALLOWED",
      ]);
    });
  });

  describe("when the caller holds no captured-content permission", () => {
    it("refuses a gated column that a fully-permitted caller may read", async () => {
      const service = serviceWith(recordingExecutor());
      const sql = "SELECT CapturedInput FROM analytics.traces";

      expect(
        await codeOf(() =>
          service.execute({
            project: PROJECT,
            protections: WITHOUT_CONTENT,
            sql,
          }),
        ),
      ).toBe("governed_sql_not_permitted");

      // The same query for a caller who holds the permission, so the refusal
      // above is about the gate rather than about the SQL.
      await expect(
        service.execute({
          project: PROJECT,
          protections: FULLY_PERMITTED,
          sql,
        }),
      ).resolves.toBeDefined();
    });

    it("refuses a wildcard it cannot prove excludes the withheld fields", async () => {
      const service = serviceWith(recordingExecutor());
      const sql = "SELECT * FROM analytics.traces";

      const meta = await metaOf(() =>
        service.execute({
          project: PROJECT,
          protections: WITHOUT_CONTENT,
          sql,
        }),
      );
      expect(
        (meta.violations as { code: string }[]).map(
          (violation) => violation.code,
        ),
      ).toContain("WILDCARD_NOT_ALLOWED");
    });

    /**
     * The decision this slice inherited: with nothing withheld there is nothing
     * a wildcard could expose, and the views publish only catalog columns — so
     * `*` is refused for a restricted caller and permitted for a whole one.
     */
    it("permits the same wildcard for a fully-permitted caller", async () => {
      await expect(
        serviceWith(recordingExecutor()).execute({
          project: PROJECT,
          protections: FULLY_PERMITTED,
          sql: "SELECT * FROM analytics.traces",
        }),
      ).resolves.toBeDefined();
    });

    it("withholds every gated column when permissions are unresolved", async () => {
      const service = serviceWith(recordingExecutor());

      // The shape `getUserProtectionsForProject` returns when the policy
      // resolver is down: nothing is explicitly `true`, so nothing is unlocked.
      for (const sql of [
        "SELECT CapturedInput FROM analytics.traces",
        "SELECT TotalCost FROM analytics.traces",
      ]) {
        expect(
          await codeOf(() =>
            service.execute({ project: PROJECT, protections: {}, sql }),
          ),
          sql,
        ).toBe("governed_sql_not_permitted");
      }
    });
  });

  describe("when a dataset the caller's permissions withhold is named", () => {
    // The shipped catalog has no dataset that is captured content end to end —
    // every one of its entries is readable in part by a caller with no content
    // permission — so this case needs a fixture, and it shares the one the
    // schema and catalog suites use rather than keeping a fourth copy.
    const serviceWithTranscripts = (executor: GovernedSqlExecutor) =>
      new GovernedSqlService({
        executor,
        database: DATABASE,
        views: [...GOVERNED_VIEW_CATALOG, GATED_DATASET],
      });

    const sql = `SELECT count() FROM ${GATED_DATASET_QUALIFIED_NAME}`;

    it("refuses the query, rather than returning the dataset's row-policed rows", async () => {
      const executor = recordingExecutor();

      expect(
        await codeOf(() =>
          serviceWithTranscripts(executor).execute({
            project: PROJECT,
            protections: WITHOUT_CONTENT,
            sql,
          }),
        ),
      ).toBe("governed_sql_not_permitted");
      expect(
        (
          (
            await metaOf(() =>
              serviceWithTranscripts(executor).execute({
                project: PROJECT,
                protections: WITHOUT_CONTENT,
                sql,
              }),
            )
          ).violations as { code: string }[]
        ).map((violation) => violation.code),
      ).toContain("TABLE_NOT_ALLOWED");
      expect(
        executor.calls,
        "a dataset the caller may not reach was queried anyway",
      ).toHaveLength(0);
    });

    it("answers the same query for a caller who holds the permission", async () => {
      const executor = recordingExecutor();

      await expect(
        serviceWithTranscripts(executor).execute({
          project: PROJECT,
          protections: FULLY_PERMITTED,
          sql,
        }),
      ).resolves.toBeDefined();
      // The refusal above is about the permission and not about the fixture:
      // the same catalog, the same statement, a different caller.
      expect(executor.calls).toHaveLength(1);
    });
  });

  describe("when a declared bound parameter has no value", () => {
    it("refuses before execution, naming every missing parameter", async () => {
      const executor = recordingExecutor();
      const service = serviceWith(executor);
      const sql =
        "SELECT count() FROM analytics.traces " +
        "WHERE OccurredAt >= {since:DateTime} AND TraceName = {name:String}";

      expect(
        await codeOf(() =>
          service.execute({
            project: PROJECT,
            protections: FULLY_PERMITTED,
            sql,
            parameters: { name: "checkout" },
          }),
        ),
      ).toBe("governed_sql_parameter_missing");
      expect(
        await metaOf(() =>
          service.execute({
            project: PROJECT,
            protections: FULLY_PERMITTED,
            sql,
            parameters: { name: "checkout" },
          }),
        ),
      ).toEqual({ parameters: ["since"] });
      expect(
        executor.calls,
        "a query with an unbound parameter reached the database",
      ).toHaveLength(0);
    });

    it("forwards the values when every parameter is supplied", async () => {
      const executor = recordingExecutor();

      await serviceWith(executor).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql: "SELECT count() FROM analytics.traces WHERE TraceName = {name:String}",
        parameters: { name: "checkout" },
      });

      expect(executor.calls[0]!.parameters).toEqual({ name: "checkout" });
    });
  });

  describe("when no restricted identity is provisioned", () => {
    /**
     * Fail-closed. The alternative — running a customer's SQL as the
     * application's own identity — is the exact substitution the isolation
     * model exists to prevent, so an unconfigured deployment must refuse.
     */
    it("refuses the query rather than running it with weaker guarantees", async () => {
      expect(
        await codeOf(() =>
          serviceWith(null).execute({
            project: PROJECT,
            protections: FULLY_PERMITTED,
            sql: "SELECT count() FROM analytics.traces",
          }),
        ),
      ).toBe("governed_sql_unavailable");
    });

    it("still describes the schema, which discloses nothing a caller could read", () => {
      expect(
        serviceWith(null).describeSchema({ protections: FULLY_PERMITTED })
          .datasets,
      ).toHaveLength(GOVERNED_VIEW_CATALOG.length);
    });
  });
});

describe("given the result ceilings", () => {
  const rows = [...Array(50).keys()].map((index) => ({
    index,
    value: "x".repeat(100),
  }));

  describe("when the row ceiling is reached", () => {
    it("cuts the result at the ceiling and reports that it did", () => {
      const capped = applyGovernedResultLimits({
        rows,
        limits: { maxRows: 10, maxResultBytes: 10_000_000 },
      });

      expect(capped.rows).toHaveLength(10);
      expect(capped.truncated).toBe(true);
      expect(capped.rows[0]).toEqual(rows[0]);
    });
  });

  describe("when the byte ceiling is reached first", () => {
    it("cuts the result short of the row ceiling and reports that it did", () => {
      const capped = applyGovernedResultLimits({
        rows,
        limits: { maxRows: 1_000, maxResultBytes: 500 },
      });

      expect(capped.rows.length).toBeGreaterThan(0);
      expect(capped.rows.length).toBeLessThan(rows.length);
      expect(capped.truncated).toBe(true);
    });
  });

  describe("when the result fits", () => {
    it("returns every row and reports no truncation", () => {
      const capped = applyGovernedResultLimits({
        rows,
        limits: { maxRows: 1_000, maxResultBytes: 10_000_000 },
      });

      expect(capped.rows).toEqual(rows);
      expect(capped.truncated).toBe(false);
    });
  });
});
