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
    expect(result.params?.dashboard_context_sources).toEqual(["application"]);
  });

  /** @scenario "QP04 A statement reading the sources parameter counts the origins it is bound to" */
  it("binds the named sources and reports no diagnostic", async () => {
    const { request, result } = await run({
      sql: READS_SOURCES,
      sources: ["application", "langy"],
    });

    expect(request?.parameters?.dashboard_context_sources).toEqual(["application", "langy"]);
    expect(result.params).toMatchObject({ dashboard_context_sources: ["application", "langy"] });
    expect(result.diagnostics.map((d) => d.code)).not.toContain("SOURCES_IGNORED");
  });

  /** @scenario "QP07 An empty list of sources binds an empty array and counts nothing where the SQL reads it" */
  it("binds an empty array for an empty list", async () => {
    const { request, result } = await run({ sql: READS_SOURCES, sources: [] });

    expect(request?.parameters?.dashboard_context_sources).toEqual([]);
    expect(result.params?.dashboard_context_sources).toEqual([]);
  });

  /** @scenario "QP07b The Source column keeps the meaning of other and of the unstamped origin, and params keeps the request's order" */
  it("echoes the sources in the order sent, a repeat kept at its first place", async () => {
    const { result } = await run({
      sql: READS_SOURCES,
      sources: ["langy", "application", "langy", "other"],
    });

    expect(result.params?.dashboard_context_sources).toEqual(["langy", "application", "other"]);
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
    expect(result.params?.dashboard_context_projects).toEqual(["project-1"]);
  });
});

describe("given a statement that does not read the sources parameter", () => {
  /** @scenario "QP05 A statement that does not read the parameter counts every origin, and a diagnostic says so" */
  it("answers SOURCES_IGNORED with its message and no sources key", async () => {
    const { result } = await run({ sql: READS_NOTHING, sources: ["application"] });

    expect(result.params).not.toHaveProperty("dashboard_context_sources");
    expect(result.diagnostics).toContainEqual({
      code: "SOURCES_IGNORED",
      message: "This query doesn't read {dashboard_context_sources}, so it counts every origin.",
    });
  });

  /** @scenario "QP06 The server adds no origin filter beneath the statement" */
  it("sends the statement as written", async () => {
    const { request } = await run({ sql: READS_NOTHING, sources: ["application"] });

    expect(request?.sql).toBe(READS_NOTHING);
  });

  /** @scenario "AC204 Sources: SQL that does not read the parameter counts every origin and says so" */
  it("counts every origin and says so in a diagnostic", async () => {
    const { request, result } = await run({ sql: READS_NOTHING, sources: ["application"] });

    expect(request?.sql).not.toMatch(/WHERE|Origin|Source/);
    expect(result.diagnostics.map((d) => d.code)).toContain("SOURCES_IGNORED");
  });

  /** @scenario "QP05b SOURCES_IGNORED comes from the parsed statement, not from its text" */
  it.each([
    [
      "a comment",
      `SELECT count() AS n FROM analytics.trace_metrics /* {dashboard_context_sources:Array(String)} */ LIMIT 1`,
    ],
    [
      "a string literal",
      `SELECT '{dashboard_context_sources:Array(String)}' AS n FROM analytics.trace_metrics LIMIT 1`,
    ],
  ])("answers SOURCES_IGNORED when the placeholder is only in %s", async (_where, sql) => {
    const { result } = await run({ sql, sources: ["application"] });

    expect(result.diagnostics.map((d) => d.code)).toContain("SOURCES_IGNORED");
  });

  /** @scenario "AC204c Sources: a placeholder only in a comment or a literal does not count as reading the parameter" */
  it("treats a commented placeholder as not read", async () => {
    const { result } = await run({
      sql: "SELECT count() AS n FROM analytics.trace_metrics /* {dashboard_context_sources:Array(String)} */ LIMIT 1",
      sources: ["application"],
    });

    expect(result.diagnostics.map((d) => d.code)).toContain("SOURCES_IGNORED");
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
    const { result } = await run({ sql: READS_SOURCES, sources: ["application"] });

    expect(result.diagnostics.map((d) => d.code)).not.toContain("SOURCES_IGNORED");
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
  /** @scenario "QP17 The params map holds the declared placeholders and the period, nothing else" */
  it("holds no key for a placeholder the statement does not declare", async () => {
    const { result } = await run({ sql: READS_NOTHING, parameters: {} });

    expect(result.params).toEqual({});
  });

  it("holds each declared placeholder by its SQL name, the period folded into period", async () => {
    const sql =
      "SELECT count() AS n FROM analytics.trace_metrics " +
      "WHERE Source IN {dashboard_context_sources:Array(String)} " +
      "AND TenantId IN {dashboard_context_projects:Array(String)} " +
      "AND Model = {model:String} " +
      "AND OccurredAt >= {dashboard_context_period_start:DateTime} " +
      "AND OccurredAt < {dashboard_context_period_end:DateTime} LIMIT 1";
    const { result } = await run({ sql, timeWindow: WINDOW, parameters: { model: "gpt-5-mini" } });

    expect(result.params).toEqual({
      dashboard_context_sources: ["application"],
      dashboard_context_projects: ["project-1"],
      model: "gpt-5-mini",
      period: WINDOW,
    });
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

  /** @scenario "QP17b A coarsened grain is reported as a diagnostic" */
  it("answers GRANULARITY_COARSENED with both grains", async () => {
    const { result } = await run({
      sql: GRAIN_SQL,
      timeWindow: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" },
      granularitySeconds: 1,
      onBudgetOverflow: "coarsen",
    });

    expect(result.params).toMatchObject({ dashboard_context_granularity_seconds: 3600 });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "GRANULARITY_COARSENED",
        meta: { requestedSeconds: 1, granularitySeconds: 3600 },
      }),
    );
  });

  it("answers no GRANULARITY_COARSENED when the grain was kept", async () => {
    const { result } = await run({
      sql: GRAIN_SQL,
      timeWindow: WINDOW,
      granularitySeconds: 3600,
      onBudgetOverflow: "coarsen",
    });

    expect(result.diagnostics.map((d) => d.code)).not.toContain("GRANULARITY_COARSENED");
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
    }
  });

  /** @scenario "QP25 A statement reading a column a data protection hides is refused, with no FIELDS_REDACTED" */
  it("refuses a hidden column at validation, naming the field and no project", async () => {
    const refusal = await refusalOf({
      sql: "SELECT Comment FROM analytics.annotations LIMIT 1",
      protections: {
        catalogue: EVERY_CATALOGUE_PERMISSION,
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
      },
    });

    expect(refusal).toMatchObject({ code: "lwql_not_permitted", httpStatus: 400 });
    const violations = JSON.stringify((refusal as { meta?: unknown }).meta);
    expect(violations).toContain("GATED_COLUMN");
    expect(violations).toContain('The field \\"Comment\\" is not available to you');
    expect(violations).not.toContain("project-1");
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

describe("given the validation the insight gate asks for", () => {
  const PROTECTIONS = {
    catalogue: EVERY_CATALOGUE_PERMISSION,
    canSeeCosts: true,
    canSeeCapturedInput: true,
    canSeeCapturedOutput: true,
  };
  const validate = (sql: string) =>
    LangWatchQLService.create({ executor: null, database: "analytics" }).validate({
      projectId: "project-1",
      protections: PROTECTIONS,
      sql,
      parameters: {},
    });

  /** @scenario "QP21 The insight gate validates a stored statement with the same binder, and refuses what the card refuses" */
  it("keeps a statement reading the sources parameter, without a run's lists", () => {
    expect(validate(READS_SOURCES).followsSources).toBe(true);
  });

  /** @scenario "AC211 Insight: the daily insight gate validates a statement with the card's binder" */
  it.each([
    ["assigns a reserved name", "WITH 'C' AS dashboard_context_projects SELECT 1 AS n"],
    [
      "declares it as String",
      "SELECT count() AS n FROM analytics.trace_metrics WHERE Source = {dashboard_context_sources:String} LIMIT 1",
    ],
  ])("refuses a statement that %s, as the card does", (_why, sql) => {
    expect(() => validate(sql)).toThrow(/reserved|Array\(String\)|dashboard_context/);
  });
});

describe("given statements over views that keep no origin", () => {
  const OWN = "SELECT count() AS n FROM analytics.langy_conversation_messages LIMIT 1";
  const ROLLUP = "SELECT count() AS n FROM analytics.trace_metrics_by_minute LIMIT 1";

  /** @scenario "AC192 Langy: data that is Langy's own is not filtered" */
  it("sends Langy's own data as written", async () => {
    const { request, result } = await run({ sql: OWN, sources: ["application"] });

    expect(request?.sql).toBe(OWN);
    expect(result.diagnostics.map((d) => d.code)).toContain("SOURCES_IGNORED");
  });

  /** @scenario "AC195 Langy: per-minute rollups cannot leave Langy out yet" */
  it("sends a per-minute rollup as written, saying it follows no sources", async () => {
    const { request, result } = await run({ sql: ROLLUP, sources: ["application"] });

    expect(request?.sql).toBe(ROLLUP);
    expect(result.diagnostics.map((d) => d.code)).toContain("SOURCES_IGNORED");
  });
});

describe("given a card run in a group project", () => {
  /** @scenario "QP02 A card run reads the board's project" */
  it("binds the board's project when the card names none", async () => {
    const sql =
      "SELECT count() AS n FROM analytics.trace_metrics WHERE TenantId IN {dashboard_context_projects:Array(String)} LIMIT 1";

    const { result } = await run({ sql });

    expect(result.params?.dashboard_context_projects).toEqual(["project-1"]);
  });

  /** @scenario "AC206b Project: a group project reads the members its grants share, each from its own date" */
  it("binds the members and cuts the dated one from its date", async () => {
    const from = Date.parse("2026-03-01T00:00:00.000Z");
    const { request, result } = await run({
      sql: "SELECT count() AS n FROM analytics.trace_metrics WHERE TenantId IN {dashboard_context_projects:Array(String)} LIMIT 1",
      projects: [
        { id: "A", lwqlKey: "ka" },
        { id: "B", lwqlKey: "kb" },
      ],
      memberWindows: [
        { projectId: "A", from: 0 },
        { projectId: "B", from },
      ],
    });

    expect(result.params?.dashboard_context_projects).toEqual(["A", "B"]);
    expect(request?.sql).toContain(`TenantId IN ('A')`);
    expect(request?.sql).toContain(
      `TenantId = 'B' AND OccurredAt >= fromUnixTimestamp64Milli(toInt64(${from}))`,
    );
  });
});

describe("given a key for a group project", () => {
  const MEMBER_SQL =
    "SELECT count() AS n FROM analytics.trace_metrics WHERE TenantId IN {dashboard_context_projects:Array(String)} LIMIT 1";

  /** @scenario "QP03c A key for a group project reads the group's members by default" */
  it("reads every member from where its grant opens, and echoes them in order", async () => {
    const from = Date.parse("2026-03-01T00:00:00.000Z");
    const { request, result } = await run({
      sql: MEMBER_SQL,
      projects: [
        { id: "A", lwqlKey: "ka" },
        { id: "B", lwqlKey: "kb" },
      ],
      memberWindows: [
        { projectId: "A", from: 0 },
        { projectId: "B", from },
      ],
    });

    expect(result.params?.dashboard_context_projects).toEqual(["A", "B"]);
    expect(request?.sql).toContain(`TenantId = 'B' AND OccurredAt >= fromUnixTimestamp64Milli`);
    expect(request?.sql).toContain(`TenantId IN ('A')`);
  });
});

describe("given a statement that compares TenantId with a project it may not read", () => {
  /**
   * @scenario "QP14 A statement widening its reach with TenantId still reads nothing it may not"
   * The reach is the capability built from the readable projects' keys, never from the SQL;
   * the row policy that enforces it is proved by tenant-column-isolation.integration.test.ts.
   */
  it("sends the capability of the readable project only, whatever the SQL names", async () => {
    const { request } = await run({
      sql: "SELECT count() AS n FROM analytics.trace_metrics WHERE TenantId = 'C' LIMIT 1",
      projects: [{ id: "A", lwqlKey: "ka" }],
    });
    const asked = await run({
      sql: "SELECT count() AS n FROM analytics.trace_metrics WHERE TenantId = 'A' LIMIT 1",
      projects: [{ id: "A", lwqlKey: "ka" }],
    });

    expect(request?.tenantCapability).toBe(asked.request?.tenantCapability);
    expect(request?.tenantCapability).not.toContain("kc");
    expect(request?.tenantCapability.split(",")).toHaveLength(1);
  });
});
