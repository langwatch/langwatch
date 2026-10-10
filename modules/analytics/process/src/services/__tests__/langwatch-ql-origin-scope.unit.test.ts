/**
 * What the database is asked when a surface leaves trace origins out of a run: the statement and
 * its completeness report are scoped alike, and a run that names no origin is sent as written.
 * @see modules/analytics/adrs/003-lwql-origin-scope.md
 */
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const PERIOD =
  "WHERE StartTime >= {dashboard_context_period_start:DateTime} " +
  "AND StartTime < {dashboard_context_period_end:DateTime}";
const WINDOWED_SQL = `SELECT count() AS n FROM analytics.spans ${PERIOD} LIMIT 1`;
const OWN_RANGE_SQL =
  "SELECT count() AS n FROM analytics.spans WHERE StartTime >= toStartOfMonth(now()) LIMIT 1";
const WINDOW = { start: "2026-02-01T00:00:00.000Z", end: "2026-02-04T00:00:00.000Z" };
const LANGY_TRACES =
  "ifNull(TraceId, '') NOT IN (SELECT TraceId FROM analytics.trace_metrics " +
  "WHERE ifNull(nullIf(Origin, ''), 'application') IN ('langy')";
const LOOKUP_BOUND = " AND OccurredAt >= subtractDays(";

/** Keeps every statement it is handed, and answers each with no rows. */
class RecordingExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);

    return Promise.resolve({
      columns: [{ name: "n", type: "UInt64" }],
      rows: [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
    });
  }
}

async function statementsSent({
  sql,
  excludeOrigins,
}: {
  sql: string;
  excludeOrigins?: readonly string[];
}): Promise<string[]> {
  const executor = new RecordingExecutor();
  const service = LangWatchQLService.create({ executor, database: "analytics" });

  await service.execute({
    project: { id: "project-1", lwqlKey: "key-1" },
    protections: {
      catalogue: EVERY_CATALOGUE_PERMISSION,
      canSeeCosts: true,
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
    },
    sql,
    timeWindow: WINDOW,
    ...(excludeOrigins ? { excludeOrigins } : {}),
  });

  return executor.requests.map((request) => request.sql);
}

describe("LangWatchQLService origin scope", () => {
  describe("given a run that leaves Langy's origin out", () => {
    describe("when the statement follows the surface's window", () => {
      it("sends the statement with the view scoped and the trace lookup bounded", async () => {
        const [statement] = await statementsSent({ sql: WINDOWED_SQL, excludeOrigins: ["langy"] });

        expect(statement).toContain(`(SELECT * FROM analytics.spans WHERE ${LANGY_TRACES}`);
        expect(statement).toContain(LOOKUP_BOUND);
        expect(statement?.endsWith(`AS spans ${PERIOD} LIMIT 1`)).toBe(true);
      });

      it("scopes the completeness report the same way, so it counts the rows the widget counts", async () => {
        const [, report] = await statementsSent({ sql: WINDOWED_SQL, excludeOrigins: ["langy"] });

        expect(report).toContain(LANGY_TRACES);
        expect(report).toContain(LOOKUP_BOUND);
      });
    });

    describe("when the statement keeps its own range", () => {
      it("scopes the view and reads the trace lookup over all history", async () => {
        const statements = await statementsSent({ sql: OWN_RANGE_SQL, excludeOrigins: ["langy"] });

        expect(statements).toHaveLength(1);
        expect(statements[0]).toContain(LANGY_TRACES);
        expect(statements[0]).not.toContain(LOOKUP_BOUND);
      });
    });
  });

  describe("given a run that names no origin to leave out", () => {
    /** @scenario "AC194 Langy: a query run outside a board is not scoped" */
    it("sends the statement as written", async () => {
      const [statement] = await statementsSent({ sql: WINDOWED_SQL });

      expect(statement).toBe(WINDOWED_SQL);
    });

    /** @scenario "AC193 Langy: the origins a board leaves out are a list a board parameter can set later" */
    it("sends the statement as written when the list is empty", async () => {
      const [statement] = await statementsSent({ sql: WINDOWED_SQL, excludeOrigins: [] });

      expect(statement).toBe(WINDOWED_SQL);
    });
  });
});
