/**
 * A statement that declares {dashboard_context_timezone:String} gets the zone the browser sent,
 * UTC when none; its completeness buckets floor days on the reader's clock, hours on the instant.
 * @see modules/analytics/specs/dashboard-widget-time-zone.feature
 */
import {
  lwqlBucketStartSql,
  lwqlKeyStatementSchema,
  lwqlStatementSchema,
} from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  ADMIT_EVERY_PLACEMENT,
  TEST_RUN_TELEMETRY,
} from "../../app/__tests__/analytics.fixture.ts";
import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const PERIOD =
  "WHERE OccurredAt >= {dashboard_context_period_start:DateTime} " +
  "AND OccurredAt < {dashboard_context_period_end:DateTime}";
const READER_BUCKET = lwqlBucketStartSql({
  column: "OccurredAt",
  granularity: "{dashboard_context_granularity_seconds:UInt32}",
  timeZone: "{dashboard_context_timezone:String}",
});
const ZONED_SQL = `SELECT ${READER_BUCKET} AS bucket, count() AS n FROM analytics.traces ${PERIOD} GROUP BY bucket`;
const UTC_SQL =
  "SELECT toStartOfInterval(OccurredAt, INTERVAL {dashboard_context_granularity_seconds:UInt32} " +
  `SECOND) AS bucket, count() AS n FROM analytics.traces ${PERIOD} GROUP BY bucket`;
const DST_WEEK = { start: "2026-10-30T07:00:00.000Z", end: "2026-11-03T08:00:00.000Z" };
const EVERYTHING_VISIBLE = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** Answers the statement first, then the completeness report, with the rows scripted for each. */
class ScriptedExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly answers: readonly (readonly Record<string, unknown>[])[] = []) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    const rows = this.answers[this.requests.length] ?? [];
    this.requests.push(request);
    return Promise.resolve({
      columns: [{ name: "n", type: "UInt64" }],
      rows,
      statistics: { elapsedMs: 1, rowsRead: 1, bytesRead: 1, rowsReturned: rows.length },
    });
  }
}

function run({
  sql,
  timeZone,
  parameters,
  answers,
  timeWindow = DST_WEEK,
  granularitySeconds = 86_400,
}: {
  sql: string;
  timeZone?: string;
  parameters?: Record<string, string>;
  answers?: readonly (readonly Record<string, unknown>[])[];
  timeWindow?: { start: string; end: string };
  granularitySeconds?: number;
}) {
  const executor = new ScriptedExecutor(answers);
  const service = LangWatchQLService.create({
    runTelemetry: TEST_RUN_TELEMETRY,
    placement: ADMIT_EVERY_PLACEMENT,
    executor,
    database: "analytics",
    limits: { maxRows: 1_000, maxResultBytes: 8_000_000 },
  });
  const result = service.execute({
    project: { id: "project-1", lwqlKey: "key-1" },
    protections: EVERYTHING_VISIBLE,
    sql,
    timeWindow,
    granularitySeconds,
    ...(timeZone ? { timeZone } : {}),
    ...(parameters ? { parameters } : {}),
  });

  return { executor, result };
}

const epochSeconds = (instant: string) => Temporal.Instant.from(instant).epochMilliseconds / 1000;

describe("given a statement that buckets by {dashboard_context_timezone:String}", () => {
  describe("when it runs with the reader's zone", () => {
    /** @scenario "TZ02 A statement declaring the time zone is bound to the reader's zone" */
    it("binds that zone, and the answer's params name it", async () => {
      const { executor, result } = run({ sql: ZONED_SQL, timeZone: "America/Los_Angeles" });

      const answer = await result;

      expect(executor.requests[0]?.parameters).toMatchObject({
        dashboard_context_timezone: "America/Los_Angeles",
      });
      expect(answer.params).toMatchObject({ dashboard_context_timezone: "America/Los_Angeles" });
    });

    /** @scenario "TZ10 The completeness buckets follow the same zone" */
    it("lists completeness buckets at each local midnight, the DST day 25 hours long", async () => {
      const { executor, result } = run({
        sql: ZONED_SQL,
        timeZone: "America/Los_Angeles",
        answers: [[], [{ bucket: epochSeconds("2026-11-01T07:00:00Z"), n: 3 }]],
      });

      const { completeness } = await result;

      expect(executor.requests[1]?.parameters).toMatchObject({
        completeness_time_zone: "America/Los_Angeles",
      });
      expect(completeness?.buckets).toEqual([
        { start: "2026-10-30T07:00:00Z", n: 0 },
        { start: "2026-10-31T07:00:00Z", n: 0 },
        { start: "2026-11-01T07:00:00Z", n: 3 },
        { start: "2026-11-02T08:00:00Z", n: 0 },
      ]);
    });
  });

  describe("when the reader is ahead of UTC", () => {
    /** @scenario "TZ10 The completeness buckets follow the same zone" */
    it("lists every hour of the window, none dropped by the offset", async () => {
      const { result } = run({
        sql: ZONED_SQL,
        timeZone: "Asia/Tokyo",
        timeWindow: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-02T00:00:00.000Z" },
        granularitySeconds: 3_600,
        answers: [[], []],
      });

      const { completeness } = await result;

      expect(completeness?.buckets).toHaveLength(24);
      expect(completeness?.buckets?.at(-1)?.start).toBe("2026-11-01T23:00:00Z");
    });
  });

  describe("when the window crosses the night the clocks go forward", () => {
    /** @scenario "TZ10 The completeness buckets follow the same zone" */
    it("lists each minute once, the skipped hour folded onto the real one", async () => {
      const { result } = run({
        sql: ZONED_SQL,
        timeZone: "America/New_York",
        timeWindow: { start: "2026-03-08T06:58:00.000Z", end: "2026-03-08T08:02:00.000Z" },
        granularitySeconds: 60,
        answers: [[], []],
      });

      const { completeness } = await result;
      const starts = completeness?.buckets?.map((bucket) => bucket.start) ?? [];

      expect(starts).toHaveLength(64);
      expect(new Set(starts).size).toBe(64);
      expect([starts[0], starts.at(-1)]).toEqual(["2026-03-08T06:58:00Z", "2026-03-08T08:01:00Z"]);
    });
  });

  describe("when an hour grain covers the local day the clocks go back", () => {
    /** @scenario "TZ14 Hourly buckets keep both copies of the hour the clocks go back" */
    it("lists 25 hours, the repeated 01:00 twice, each with its own count", async () => {
      const { result } = run({
        sql: ZONED_SQL,
        timeZone: "America/Los_Angeles",
        timeWindow: { start: "2026-11-01T07:00:00.000Z", end: "2026-11-02T08:00:00.000Z" },
        granularitySeconds: 3_600,
        answers: [
          [],
          [
            { bucket: epochSeconds("2026-11-01T08:00:00Z"), n: 2 },
            { bucket: epochSeconds("2026-11-01T09:00:00Z"), n: 5 },
          ],
        ],
      });

      const { completeness } = await result;
      const buckets = completeness?.buckets ?? [];

      expect(buckets).toHaveLength(25);
      expect(new Set(buckets.map((bucket) => bucket.start)).size).toBe(25);
      expect(buckets.slice(0, 3)).toEqual([
        { start: "2026-11-01T07:00:00Z", n: 0 },
        { start: "2026-11-01T08:00:00Z", n: 2 },
        { start: "2026-11-01T09:00:00Z", n: 5 },
      ]);
      expect(buckets.at(-1)?.start).toBe("2026-11-02T07:00:00Z");
    });
  });

  describe("when an hour grain covers the local day the clocks go forward", () => {
    /** @scenario "TZ15 Hourly buckets across the night the clocks go forward" */
    it("lists 23 hours, each once", async () => {
      const { result } = run({
        sql: ZONED_SQL,
        timeZone: "America/New_York",
        timeWindow: { start: "2026-03-08T05:00:00.000Z", end: "2026-03-09T04:00:00.000Z" },
        granularitySeconds: 3_600,
        answers: [[], [{ bucket: epochSeconds("2026-03-08T07:00:00Z"), n: 1 }]],
      });

      const { completeness } = await result;
      const buckets = completeness?.buckets ?? [];

      expect(buckets).toHaveLength(23);
      expect(new Set(buckets.map((bucket) => bucket.start)).size).toBe(23);
      expect(buckets.slice(1, 3)).toEqual([
        { start: "2026-03-08T06:00:00Z", n: 0 },
        { start: "2026-03-08T07:00:00Z", n: 1 },
      ]);
    });
  });

  describe("when it runs with no time zone", () => {
    /** @scenario "TZ04 A run that names no time zone binds UTC" */
    it("binds UTC", async () => {
      const { executor, result } = run({ sql: ZONED_SQL });

      await result;

      expect(executor.requests[0]?.parameters).toMatchObject({
        dashboard_context_timezone: "UTC",
      });
      expect(executor.requests[1]?.parameters).not.toHaveProperty("completeness_time_zone");
    });
  });

  describe("when the request supplies the zone under parameters", () => {
    /** @scenario "TZ07 A request that supplies the time zone as a parameter is refused" */
    it("is refused as a reserved parameter, and nothing runs", async () => {
      const { executor, result } = run({
        sql: ZONED_SQL,
        parameters: { dashboard_context_timezone: "Europe/Amsterdam" },
      });

      await expect(result).rejects.toMatchObject({ code: "lwql_reserved_parameter_supplied" });
      expect(executor.requests).toHaveLength(0);
    });
  });
});

describe("given a statement that declares the zone with a type other than String", () => {
  /** @scenario "TZ08 A time zone declared with a type other than String is refused" */
  it("is refused with lwql_reserved_parameter_type, and nothing runs", async () => {
    const { executor, result } = run({
      sql: `SELECT {dashboard_context_timezone:UInt32} AS zone FROM analytics.traces ${PERIOD}`,
      timeZone: "America/Los_Angeles",
    });

    await expect(result).rejects.toMatchObject({ code: "lwql_reserved_parameter_type" });
    expect(executor.requests).toHaveLength(0);
  });
});

describe("given a saved statement that says nothing of a zone", () => {
  /** @scenario "TZ05 A statement that does not declare the time zone runs as before" */
  it("binds no zone and keeps its completeness buckets on UTC edges", async () => {
    const { executor, result } = run({
      sql: UTC_SQL,
      timeZone: "America/Los_Angeles",
      answers: [[], []],
    });

    const { completeness } = await result;

    expect(executor.requests[0]?.parameters).not.toHaveProperty("dashboard_context_timezone");
    expect(completeness?.buckets?.map((bucket) => bucket.start)).toEqual([
      "2026-10-30T00:00:00Z",
      "2026-10-31T00:00:00Z",
      "2026-11-01T00:00:00Z",
      "2026-11-02T00:00:00Z",
      "2026-11-03T00:00:00Z",
    ]);
  });
});

describe("given a run that names a time zone", () => {
  /** @scenario "TZ06 A time zone that is not an IANA name is refused at the door" */
  it.each(["Mars/Olympus", "UTC'); DROP TABLE x; --", "+05:00", ""])(
    "refuses %j on both doors with an issue on timeZone",
    (timeZone) => {
      for (const schema of [lwqlStatementSchema, lwqlKeyStatementSchema]) {
        const parsed = schema.safeParse({ sql: "SELECT 1", timeZone });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues[0]?.path).toEqual(["timeZone"]);
      }
    },
  );

  it.each(["America/Los_Angeles", "UTC", "Asia/Kolkata", "America/Argentina/Buenos_Aires"])(
    "accepts %j",
    (timeZone) => {
      expect(lwqlStatementSchema.validate({ sql: "SELECT 1", timeZone })).toBe(true);
    },
  );
});
