/**
 * What a run is bound to and what it answers: the sources and projects reach the statement as
 * typed values, a statement that does not read them is sent as written, and `params` says which.
 * @see specs/lwql/query-params.feature
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const READS_SOURCES =
  "SELECT count() AS n FROM analytics.trace_metrics " +
  "WHERE Source IN {dashboard_context_sources:Array(String)} LIMIT 1";
const READS_NOTHING = "SELECT count() AS n FROM analytics.trace_metrics LIMIT 1";
const WINDOW = { start: "2026-02-01T00:00:00.000Z", end: "2026-02-04T00:00:00.000Z" };
const PERIOD_SQL =
  "SELECT count() AS n FROM analytics.trace_metrics " +
  "WHERE OccurredAt >= {dashboard_context_period_start:DateTime} " +
  "AND OccurredAt < {dashboard_context_period_end:DateTime} LIMIT 1";
const GRAIN_SQL =
  "SELECT toStartOfInterval(OccurredAt, INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND) AS t, " +
  "count() AS n FROM analytics.trace_metrics " +
  "WHERE OccurredAt >= {dashboard_context_period_start:DateTime} " +
  "AND OccurredAt < {dashboard_context_period_end:DateTime} GROUP BY t LIMIT 100";

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

type RunInput = Partial<Parameters<LangWatchQLService["executeForProjects"]>[0]> & { sql: string };

async function run(input: RunInput) {
  const executor = new RecordingExecutor();
  const service = LangWatchQLService.create({ executor, database: "analytics" });
  const result = await service.executeForProjects({
    projects: [{ id: "project-1", lwqlKey: "key-1" }],
    protections: {
      catalogue: EVERY_CATALOGUE_PERMISSION,
      canSeeCosts: true,
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
    },
    ...input,
  });

  return { result, request: executor.requests[0] };
}

const refusalOf = (input: RunInput) => run(input).catch((error: unknown) => error);

describe("given a statement that reads {dashboard_context_sources}", () => {
  /** @scenario "QP01 A run that names no sources is bound to application" */
  it("binds application when the run names no sources", async () => {
    const { request, result } = await run({ sql: READS_SOURCES });

    expect(request?.parameters?.dashboard_context_sources).toEqual(["application"]);
    expect(result.params?.sources).toEqual(["application"]);
  });

  /** @scenario "QP04 A statement reading the sources parameter counts the origins it is bound to" */
  it("binds the named sources and reports that the statement followed them", async () => {
    const { request, result } = await run({
      sql: READS_SOURCES,
      sources: ["application", "langy"],
    });

    expect(request?.parameters?.dashboard_context_sources).toEqual(["application", "langy"]);
    expect(result.params).toMatchObject({
      sources: ["application", "langy"],
      followsSources: true,
    });
  });

  /** @scenario "QP07 An empty list of sources binds an empty array and counts nothing where the SQL reads it" */
  it("binds an empty array for an empty list", async () => {
    const { request, result } = await run({ sql: READS_SOURCES, sources: [] });

    expect(request?.parameters?.dashboard_context_sources).toEqual([]);
    expect(result.params?.sources).toEqual([]);
  });

  /** @scenario "QP07b The Source column keeps the meaning of other and of the unstamped origin, and params keeps the request's order" */
  it("echoes the sources in the order sent, a repeat kept at its first place", async () => {
    const { result } = await run({
      sql: READS_SOURCES,
      sources: ["langy", "application", "langy", "other"],
    });

    expect(result.params?.sources).toEqual(["langy", "application", "other"]);
  });

  /** @scenario "AC203 Sources: a query reading the parameter is kept to the list it stores" */
  it("binds a null list as the default, and the stored list as stored", async () => {
    const stored = await run({ sql: READS_SOURCES, sources: ["application", "langy"] });
    const unset = await run({ sql: READS_SOURCES, sources: null });

    expect(stored.request?.parameters?.dashboard_context_sources).toEqual(["application", "langy"]);
    expect(unset.request?.parameters?.dashboard_context_sources).toEqual(["application"]);
  });

  /** @scenario "AC206 Project: a card reads the board's project unless its query names others" */
  it("binds the projects the run reads", async () => {
    const sql =
      "SELECT count() AS n FROM analytics.trace_metrics " +
      "WHERE TenantId IN {dashboard_context_projects:Array(String)} LIMIT 1";

    const { request, result } = await run({ sql });

    expect(request?.parameters?.dashboard_context_projects).toEqual(["project-1"]);
    expect(result.params?.projects).toEqual(["project-1"]);
  });
});

describe("given a statement that does not read the sources parameter", () => {
  /** @scenario "QP05 A statement that does not read the parameter counts every origin, and params says so" */
  it("reports followsSources false and the sources the run was bound to", async () => {
    const { result } = await run({ sql: READS_NOTHING, sources: ["application"] });

    expect(result.params).toMatchObject({ sources: ["application"], followsSources: false });
  });

  /** @scenario "QP06 The server adds no origin filter beneath the statement" */
  it("sends the statement as written", async () => {
    const { request } = await run({ sql: READS_NOTHING, sources: ["application"] });

    expect(request?.sql).toBe(READS_NOTHING);
  });

  /** @scenario "AC204 Sources: SQL that does not read the parameter counts every origin and says so" */
  it("counts every origin and says so in params", async () => {
    const { request, result } = await run({ sql: READS_NOTHING, sources: ["application"] });

    expect(request?.sql).not.toMatch(/WHERE|Origin|Source/);
    expect(result.params?.followsSources).toBe(false);
  });

  /** @scenario "QP05b followsSources comes from the parsed statement, not from its text" */
  it.each([
    [
      "a comment",
      `SELECT count() AS n FROM analytics.trace_metrics /* {dashboard_context_sources:Array(String)} */ LIMIT 1`,
    ],
    [
      "a string literal",
      `SELECT '{dashboard_context_sources:Array(String)}' AS n FROM analytics.trace_metrics LIMIT 1`,
    ],
  ])("answers false when the placeholder is only in %s", async (_where, sql) => {
    const { result } = await run({ sql });

    expect(result.params?.followsSources).toBe(false);
  });

  /** @scenario "AC204c Sources: a placeholder only in a comment or a literal does not count as reading the parameter" */
  it("treats a commented placeholder as not read", async () => {
    const { result } = await run({
      sql: "SELECT count() AS n FROM analytics.trace_metrics /* {dashboard_context_sources:Array(String)} */ LIMIT 1",
    });

    expect(result.params?.followsSources).toBe(false);
  });
});

describe("given a reserved list name", () => {
  /** @scenario "QP15 A caller cannot supply a reserved parameter in its own parameters" */
  it.each(["dashboard_context_sources", "dashboard_context_projects"])(
    "refuses a caller supplying %s",
    async (name) => {
      const refusal = await refusalOf({
        sql: READS_SOURCES,
        parameters: { [name]: ["x"] },
      });

      expect(refusal).toMatchObject({ code: "lwql_reserved_parameter_supplied" });
    },
  );

  /** @scenario "QP15b SQL that assigns or aliases a reserved name is refused at every door" */
  it.each([
    ["SET", "SET param_dashboard_context_projects = 'C'; SELECT 1 AS n"],
    ["an alias", "WITH 'C' AS dashboard_context_projects SELECT 1 AS n"],
    [
      "a CTE",
      "WITH dashboard_context_sources AS (SELECT 1 AS x) SELECT x FROM dashboard_context_sources",
    ],
  ])("refuses %s", async (_shape, sql) => {
    const refusal = await refusalOf({ sql });

    expect(refusal).toMatchObject({ code: "lwql_reserved_parameter_supplied" });
  });

  /** @scenario "AC205b Params: a query cannot assign or alias a reserved name" */
  it("allows declaring the typed placeholder and reading it", async () => {
    const { result } = await run({ sql: READS_SOURCES });

    expect(result.params?.followsSources).toBe(true);
  });

  /** @scenario "QP16 A statement declaring a reserved parameter with another type is refused" */
  it("refuses the wrong declared type, naming Array(String)", async () => {
    const refusal = await refusalOf({
      sql: "SELECT count() AS n FROM analytics.trace_metrics WHERE TenantId = {dashboard_context_projects:String} LIMIT 1",
    });

    expect(refusal).toMatchObject({ code: "lwql_reserved_parameter_type" });
    expect((refusal as Error).message).toContain("Array(String)");
  });

  /** @scenario "AC205 Sources: a query declaring the parameter with another type is refused" */
  it("refuses {dashboard_context_sources:String}", async () => {
    const refusal = await refusalOf({
      sql: "SELECT count() AS n FROM analytics.trace_metrics WHERE Source = {dashboard_context_sources:String} LIMIT 1",
    });

    expect(refusal).toMatchObject({ code: "lwql_reserved_parameter_type" });
  });
});

describe("given the params a run answers with", () => {
  /** @scenario "QP17 The params object holds exactly these keys" */
  it("holds the keys of a run that follows no period", async () => {
    const { result } = await run({ sql: READS_NOTHING, parameters: {} });

    expect(Object.keys(result.params ?? {}).toSorted()).toEqual(
      ["followsSources", "parameters", "projects", "sources"].toSorted(),
    );
  });

  /** @scenario "QP13 The share windows and the redaction hold when projects are named" */
  it("holds project ids only, never a window, a protection or a key", async () => {
    const { result } = await run({
      sql: READS_NOTHING,
      memberWindows: [{ projectId: "project-1", from: 0 }],
    });

    expect(JSON.stringify(result.params)).not.toMatch(/key-1|canSee|from|window/);
  });

  it("holds the period the statement followed", async () => {
    const { result } = await run({ sql: PERIOD_SQL, timeWindow: WINDOW });

    expect(result.params?.period).toEqual(WINDOW);
  });

  /** @scenario "QP17b A coarsened grain is reported" */
  it("reports the grain it coarsened from", async () => {
    const { result } = await run({
      sql: GRAIN_SQL,
      timeWindow: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" },
      granularitySeconds: 1,
      onBudgetOverflow: "coarsen",
    });

    expect(result.params).toMatchObject({ granularitySeconds: 3600, coarsenedFromSeconds: 1 });
  });

  it("carries no coarsenedFromSeconds when the grain was kept", async () => {
    const { result } = await run({
      sql: GRAIN_SQL,
      timeWindow: WINDOW,
      granularitySeconds: 3600,
      onBudgetOverflow: "coarsen",
    });

    expect(result.params).not.toHaveProperty("coarsenedFromSeconds");
  });
});

describe("given a run limited by a dated member's window", () => {
  const DATED = [{ projectId: "project-1", from: Date.parse("2026-03-01T00:00:00.000Z") }];

  /** @scenario "QP26 SHARE_WINDOW_LIMITED appears when a dated member's rows were cut by its window" */
  it("adds SHARE_WINDOW_LIMITED, naming no project and counting none", async () => {
    const { result } = await run({ sql: READS_NOTHING, memberWindows: DATED });

    const found = result.diagnostics.filter(({ code }) => code === "SHARE_WINDOW_LIMITED");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toBe(
      "Some projects share data only from a date, so earlier rows are not included",
    );
    expect(JSON.stringify(found)).not.toMatch(/project-1|\d/);
  });

  /** @scenario "QP27 A run the server did not limit carries neither diagnostic" */
  it("adds nothing when no member is dated", async () => {
    const whole = await run({
      sql: READS_NOTHING,
      memberWindows: [{ projectId: "project-1", from: 0 }],
    });
    const plain = await run({ sql: READS_NOTHING });

    for (const { result } of [whole, plain]) {
      expect(result.diagnostics.map(({ code }) => code)).not.toContain("SHARE_WINDOW_LIMITED");
      expect(result.diagnostics.map(({ code }) => code)).not.toContain("FIELDS_REDACTED");
    }
  });

  /** @scenario "QP28 No limiting diagnostic names or counts a project the caller cannot read" */
  it("holds no id, name or number in the diagnostic", async () => {
    const { result } = await run({
      sql: READS_NOTHING,
      memberWindows: [...DATED, { projectId: "project-secret", from: 5 }],
    });

    expect(JSON.stringify(result.diagnostics)).not.toMatch(/project-|secret|\d/);
  });
});
