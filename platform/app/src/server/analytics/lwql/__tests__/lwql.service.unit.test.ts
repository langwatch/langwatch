/**
 * The LangWatchQL service: what it refuses, what it forwards, and what it
 * never touches.
 *
 * A fake executor rather than a mock, because the interesting claims are about
 * *what reached the database* — the statement, the tenant capability, the fact
 * that nothing reached it at all — and those are artifacts to inspect, not call
 * sequences to verify. The fake records; the tests read the record.
 *
 * The capping the executor itself does is asserted against
 * {@link applyLangWatchQLResultLimits} directly, because a fake that implemented
 * its own truncation would prove only that the fake truncates.
 *
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { Protections } from "../../../traces/protections";
import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import {
  applyLangWatchQLResultLimits,
  type LangWatchQLExecutor,
} from "../executor";
import { recordingExecutor } from "../executor.testFakes";
import {
  closeLangWatchQLService,
  LangWatchQLService,
  setLangWatchQLService,
} from "../lwql.service";
import {
  GATED_DATASET,
  GATED_DATASET_QUALIFIED_NAME,
} from "./gatedDatasetFixture";

const DATABASE = "analytics";

const PROJECT = {
  id: "project-under-test",
  lwqlKey: "sk-lw-lwql-service-unit-test-key",
};

/**
 * The same project as it comes off Prisma: carrying `apiKey` beside the
 * LangWatchQL secret.
 *
 * Its own fixture because `LangWatchQLCaller` names only the two fields the
 * service needs, and the decoupling claim is precisely that the extra one is
 * never reached for — a fixture without it could not tell the difference.
 */
const PROJECT_WITH_API_KEY = {
  ...PROJECT,
  apiKey: "sk-lw-project-api-key-service-unit-test",
};

/** A project whose `lwqlKey` was never selected. */
const PROJECT_WITHOUT_LWQL_KEY = { ...PROJECT, lwqlKey: "" };

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

function serviceWith(executor: LangWatchQLExecutor | null): LangWatchQLService {
  return new LangWatchQLService({ executor, database: DATABASE });
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

describe("given the LangWatchQL service", () => {
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
        "3b39a279643e25b0dc08d6ef2f4c6bec873da8fa96a1c7c0b46821c25c9ca0b6e93943bb883b397d76ab896d07b9c7764f0ee8cc2cf9b815cb4e17d320d197a0",
      );
      // The raw key is the secret the digest exists to keep out of the
      // database; a capability that merely contained it would be a leak.
      expect(executor.calls[0]!.tenantCapability).not.toContain(
        PROJECT.lwqlKey,
      );
    });

    /**
     * The control behind the decoupling: the capability names a *tenant*, and
     * `Project.apiKey` is a credential that rotates on its own schedule. Both
     * digests are written out, so swapping which field the service hashes turns
     * this red — a test that only checked "some digest was sent" would pass
     * either way, and the failure in production is silent (every LangWatchQL read
     * returns zero rows, which reads as a tenant with no data).
     */
    it("derives the capability from the LangWatchQL key, never from the project's API key", async () => {
      const executor = recordingExecutor();

      await serviceWith(executor).execute({
        project: PROJECT_WITH_API_KEY,
        protections: FULLY_PERMITTED,
        sql: "SELECT count() FROM analytics.traces",
      });

      expect(executor.calls[0]!.tenantCapability).toBe(
        "3b39a279643e25b0dc08d6ef2f4c6bec873da8fa96a1c7c0b46821c25c9ca0b6e93943bb883b397d76ab896d07b9c7764f0ee8cc2cf9b815cb4e17d320d197a0",
      );
      // SHA-512 of PROJECT_WITH_API_KEY.apiKey — what the key map would have to
      // hold instead, and what no LangWatchQL query may ever present.
      expect(executor.calls[0]!.tenantCapability).not.toBe(
        "95a41ba91b26b8c5d6143c96a071fe6309f1e5fdb464fe2e10e2e0ae464089bf0f1fc253c0bab6f6530581dfb268f511a53a9fc49cf87caf0ed2f1531e8be690",
      );
      expect(executor.calls[0]!.tenantCapability).not.toContain(
        PROJECT_WITH_API_KEY.apiKey,
      );
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
      ).toBe("lwql_not_permitted");
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
        ).toBe("lwql_not_permitted");
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
      ).toBe("lwql_unparseable");
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
      ).toBe("lwql_not_permitted");

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
        ).toBe("lwql_not_permitted");
      }
    });
  });

  describe("when a dataset the caller's permissions withhold is named", () => {
    // The shipped catalog has no dataset that is captured content end to end —
    // every one of its entries is readable in part by a caller with no content
    // permission — so this case needs a fixture, and it shares the one the
    // schema and catalog suites use rather than keeping a fourth copy.
    const serviceWithTranscripts = (executor: LangWatchQLExecutor) =>
      new LangWatchQLService({
        executor,
        database: DATABASE,
        views: [...LWQL_VIEW_CATALOG, GATED_DATASET],
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
      ).toBe("lwql_not_permitted");
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
      ).toBe("lwql_parameter_missing");
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

  describe("when the statement declares the reserved time-window parameters", () => {
    const PERIOD_SQL =
      "SELECT count() AS value FROM analytics.traces " +
      "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime}";
    const TIME_WINDOW = {
      start: new Date("2026-02-20T00:00:00.000Z"),
      end: new Date("2026-02-27T00:00:00.000Z"),
    };

    /** @scenario "A statement declaring the reserved period parameters is given the surface's window" */
    it("binds the surface's window without the caller supplying either value", async () => {
      const executor = recordingExecutor();

      const result = await serviceWith(executor).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql: PERIOD_SQL,
        timeWindow: TIME_WINDOW,
      });

      expect(executor.calls[0]!.parameters).toEqual({
        period_start: "2026-02-20 00:00:00",
        period_end: "2026-02-27 00:00:00",
      });
      // The statement itself is never rewritten to carry them.
      expect(executor.calls[0]!.sql).toBe(PERIOD_SQL);
      expect(result.followsTimeWindow).toBe(true);
    });

    /** @scenario "A statement declaring the reserved period parameters is given the surface's window" */
    it("hands a different window down when the surface is showing a different period", async () => {
      const executor = recordingExecutor();
      const service = serviceWith(executor);

      for (const start of ["2026-02-20", "2026-03-20"]) {
        await service.execute({
          project: PROJECT,
          protections: FULLY_PERMITTED,
          sql: PERIOD_SQL,
          timeWindow: { ...TIME_WINDOW, start: new Date(`${start}T00:00:00Z`) },
        });
      }

      expect(
        executor.calls.map((call) => call.parameters?.period_start),
      ).toEqual(["2026-02-20 00:00:00", "2026-03-20 00:00:00"]);
    });

    /** @scenario "A caller that supplies a reserved period parameter itself is refused" */
    it("refuses a request that sets one of them itself, before execution", async () => {
      const executor = recordingExecutor();
      const service = serviceWith(executor);
      const run = () =>
        service.execute({
          project: PROJECT,
          protections: FULLY_PERMITTED,
          sql: PERIOD_SQL,
          parameters: { period_start: "2020-01-01 00:00:00" },
          timeWindow: TIME_WINDOW,
        });

      expect(await codeOf(run)).toBe("lwql_reserved_parameter_supplied");
      expect(await metaOf(run)).toEqual({ parameters: ["period_start"] });
      expect(
        executor.calls,
        "a chart that pinned its own window reached the database",
      ).toHaveLength(0);
    });

    /** @scenario "A reserved period parameter declared as anything but a date-time is refused" */
    it("refuses a reserved name declared as a string, at run and at validation alike", async () => {
      const executor = recordingExecutor();
      const service = serviceWith(executor);
      const sql =
        "SELECT count() FROM analytics.traces WHERE TraceName = {period_start:String}";

      expect(
        await codeOf(() =>
          service.execute({
            project: PROJECT,
            protections: FULLY_PERMITTED,
            sql,
            timeWindow: TIME_WINDOW,
          }),
        ),
      ).toBe("lwql_reserved_parameter_type");
      expect(executor.calls).toHaveLength(0);

      // The step saving a chart goes through is this one, so a chart carrying
      // that declaration cannot be written either.
      expect(
        await codeOf(async () =>
          service.validate({
            projectId: PROJECT.id,
            protections: FULLY_PERMITTED,
            sql,
          }),
        ),
      ).toBe("lwql_reserved_parameter_type");
    });

    /** @scenario "A period-aware statement run with no window names what is unset" */
    it("refuses to run with no window, while still validating for a save", async () => {
      const executor = recordingExecutor();
      const service = serviceWith(executor);

      expect(
        await codeOf(() =>
          service.execute({
            project: PROJECT,
            protections: FULLY_PERMITTED,
            sql: PERIOD_SQL,
          }),
        ),
      ).toBe("lwql_parameter_missing");
      expect(
        await metaOf(() =>
          service.execute({
            project: PROJECT,
            protections: FULLY_PERMITTED,
            sql: PERIOD_SQL,
          }),
        ),
      ).toEqual({ parameters: ["period_end", "period_start"] });
      expect(executor.calls).toHaveLength(0);

      // Saving is not running: the window belongs to whoever later renders the
      // chart, so a definition that supplies no value for it is complete.
      const validated = service.validate({
        projectId: PROJECT.id,
        protections: FULLY_PERMITTED,
        sql: PERIOD_SQL,
      });
      expect(validated.followsTimeWindow).toBe(true);
      expect(validated.awaitingTimeWindow).toEqual([
        "period_end",
        "period_start",
      ]);
    });

    it("defers a declared granularity to the surface instead of refusing it as caller-missing", () => {
      // The caller is forbidden to supply period_granularity_seconds, so the
      // missing-parameter sweep naming it was a dead end: a refusal asking
      // for a value the caller may never send. The declaration is awaiting
      // the surface -- the granularity resolver binds the step at run.
      const service = serviceWith(recordingExecutor());
      const sql =
        "SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket, " +
        "count() AS value FROM analytics.traces " +
        "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime} " +
        "GROUP BY bucket ORDER BY bucket";

      const validated = service.validate({
        projectId: PROJECT.id,
        protections: FULLY_PERMITTED,
        sql,
        timeWindow: TIME_WINDOW,
      });
      expect(validated.awaitingTimeWindow).toEqual([
        "period_granularity_seconds",
      ]);

      // Saving has no window either; the whole reserved trio is deferred.
      const saved = service.validate({
        projectId: PROJECT.id,
        protections: FULLY_PERMITTED,
        sql,
      });
      expect(saved.awaitingTimeWindow).toEqual([
        "period_end",
        "period_granularity_seconds",
        "period_start",
      ]);
    });
  });

  describe("when the statement declares no time-window parameters", () => {
    /** @scenario "A statement with no period parameters runs, and says so" */
    it("runs unchanged and reports that it does not follow the period", async () => {
      const executor = recordingExecutor();

      const result = await serviceWith(executor).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql: BOUNDED_COUNT,
        timeWindow: {
          start: new Date("2026-02-20T00:00:00.000Z"),
          end: new Date("2026-02-27T00:00:00.000Z"),
        },
      });

      expect(result.followsTimeWindow).toBe(false);
      expect(executor.calls[0]!.sql).toBe(BOUNDED_COUNT);
      expect(
        executor.calls[0]!.parameters,
        "a window was injected into a statement that never asked for one",
      ).toBeUndefined();
    });
  });

  describe("when the statement declares the granularity parameter", () => {
    const GRANULARITY_SQL =
      "SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket, " +
      "count() AS value FROM analytics.traces " +
      "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime} " +
      "GROUP BY bucket ORDER BY bucket";
    const TIME_WINDOW = {
      start: new Date("2026-02-20T00:00:00.000Z"),
      end: new Date("2026-02-27T00:00:00.000Z"),
    };
    /** Seven days, in seconds — the window's own arithmetic. */
    const WEEK_SECONDS = 7 * 24 * 3600;

    /** @scenario "A chart declaring the granularity parameter runs at the step the surface supplies" */
    it("binds the supplied step alongside the surface's window and reports both facts", async () => {
      const executor = recordingExecutor();

      const result = await serviceWith(executor).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql: GRANULARITY_SQL,
        timeWindow: TIME_WINDOW,
        granularitySeconds: 3600,
      });

      expect(executor.calls[0]!.parameters).toEqual({
        period_start: "2026-02-20 00:00:00",
        period_end: "2026-02-27 00:00:00",
        period_granularity_seconds: 3600,
      });
      expect(result.followsGranularity).toBe(true);
      expect(result.granularitySeconds).toBe(3600);
      expect(result.followsTimeWindow).toBe(true);
      // Nothing coarsened: an hour over a week fits the ceiling comfortably.
      expect(result.coarsenedFromSeconds).toBeUndefined();
    });

    /** @scenario "A declared granularity with no step supplied refuses to run naming the parameter" */
    it("refuses to run when no step was supplied, naming the parameter", async () => {
      const executor = recordingExecutor();
      const service = serviceWith(executor);
      const run = () =>
        service.execute({
          project: PROJECT,
          protections: FULLY_PERMITTED,
          sql: GRANULARITY_SQL,
          timeWindow: TIME_WINDOW,
        });

      expect(await codeOf(run)).toBe("lwql_parameter_missing");
      expect(await metaOf(run)).toEqual({
        parameters: ["period_granularity_seconds"],
      });
      expect(
        executor.calls,
        "a declared step with no value reached the database",
      ).toHaveLength(0);

      // Saving is not running: the same statement validates for a save with
      // nothing refused, because the step belongs to whoever later renders
      // the chart.
      const validated = service.validate({
        projectId: PROJECT.id,
        protections: FULLY_PERMITTED,
        sql: GRANULARITY_SQL,
      });
      expect(validated.awaitingTimeWindow).toEqual([
        "period_end",
        "period_granularity_seconds",
        "period_start",
      ]);
    });

    it("refuses a window finer than the bucket ceiling before execution, carrying the arithmetic", async () => {
      const executor = recordingExecutor();
      const service = serviceWith(executor);
      const run = () =>
        service.execute({
          project: PROJECT,
          protections: FULLY_PERMITTED,
          sql: GRANULARITY_SQL,
          timeWindow: TIME_WINDOW,
          granularitySeconds: 1,
        });

      expect(await codeOf(run)).toBe("lwql_granularity_too_fine");
      expect(await metaOf(run)).toMatchObject({
        requestedGranularitySeconds: 1,
        windowSeconds: WEEK_SECONDS,
        maxBuckets: 10_000,
      });
      expect(
        executor.calls,
        "an overflowing budget reached the database",
      ).toHaveLength(0);
    });

    it("runs a statement that does not declare the parameter untouched, reporting that it does not follow granularity", async () => {
      const executor = recordingExecutor();

      const result = await serviceWith(executor).execute({
        project: PROJECT,
        protections: FULLY_PERMITTED,
        sql: BOUNDED_COUNT,
        granularitySeconds: 60,
      });

      expect(result.followsGranularity).toBe(false);
      expect(result.granularitySeconds).toBeUndefined();
      expect(
        executor.calls[0]!.parameters,
        "a step was injected into a statement that never asked for one",
      ).toBeUndefined();
    });

    it("refuses a malformed step as a wrong declaration rather than running it", async () => {
      for (const step of [0, -60, 1.5]) {
        expect(
          await codeOf(() =>
            serviceWith(recordingExecutor()).execute({
              project: PROJECT,
              protections: FULLY_PERMITTED,
              sql: GRANULARITY_SQL,
              timeWindow: TIME_WINDOW,
              granularitySeconds: step,
            }),
          ),
          `step ${step}`,
        ).toBe("lwql_granularity_parameter_type");
      }
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
      ).toBe("lwql_unavailable");
    });

    it("still describes the schema, which discloses nothing a caller could read", () => {
      expect(
        serviceWith(null).describeSchema({ protections: FULLY_PERMITTED })
          .datasets,
      ).toHaveLength(LWQL_VIEW_CATALOG.length);
    });
  });

  describe("when the project carries no LangWatchQL key", () => {
    /**
     * The shape this catches is a caller that forgot `lwqlKey` in its
     * Prisma select. Hashing the empty value produces a valid digest matching
     * no key-map row, so the query would run and return zero rows — which is
     * indistinguishable from a tenant with no data, and stays that way until
     * someone asks why the numbers are missing.
     *
     * A plain `Error`, not a handled one: nothing the caller of the API did
     * causes it and nothing they can do fixes it (ADR-045).
     */
    it("fails loudly instead of hashing an empty secret into a digest that matches nothing", async () => {
      const executor = recordingExecutor();

      await expect(
        serviceWith(executor).execute({
          project: PROJECT_WITHOUT_LWQL_KEY,
          protections: FULLY_PERMITTED,
          sql: "SELECT count() FROM analytics.traces",
        }),
      ).rejects.toThrow(
        "LangWatchQL tenant capability requires a non-empty secret",
      );

      // Nothing reached the database: the refusal is before execution, not a
      // query that ran and quietly answered nothing.
      expect(executor.calls).toHaveLength(0);
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
      const capped = applyLangWatchQLResultLimits({
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
      const capped = applyLangWatchQLResultLimits({
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
      const capped = applyLangWatchQLResultLimits({
        rows,
        limits: { maxRows: 1_000, maxResultBytes: 10_000_000 },
      });

      expect(capped.rows).toEqual(rows);
      expect(capped.truncated).toBe(false);
    });
  });
});

describe("handing back the transport when the service is replaced", () => {
  describe("given a service whose executor holds a connection pool", () => {
    describe("when the process-wide service is cleared", () => {
      it("closes the executor rather than abandoning its sockets", async () => {
        const close = vi.fn(async () => {});
        setLangWatchQLService(
          new LangWatchQLService({
            executor: { execute: vi.fn(), close },
            database: "analytics",
          }),
        );

        await closeLangWatchQLService();

        expect(close).toHaveBeenCalledTimes(1);
      });

      it("clears the cache, so the next read builds a fresh service", async () => {
        const first = new LangWatchQLService({
          executor: { execute: vi.fn(), close: vi.fn(async () => {}) },
          database: "analytics",
        });
        setLangWatchQLService(first);

        await closeLangWatchQLService();
        // Nothing to close the second time: the cache is empty, not stale.
        await expect(closeLangWatchQLService()).resolves.toBeUndefined();
      });

      it("tolerates an executor seam that holds nothing to close", async () => {
        setLangWatchQLService(
          new LangWatchQLService({
            executor: { execute: vi.fn() },
            database: "analytics",
          }),
        );

        await expect(closeLangWatchQLService()).resolves.toBeUndefined();
      });
    });
  });
});
