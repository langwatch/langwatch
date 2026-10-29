/**
 * The wire shape of a run's projects and sources: what each door accepts and refuses.
 * @see specs/lwql/query-params.feature
 */
import { describe, expect, it } from "vitest";

import { lwqlKeyStatementSchema } from "../analytics-lwql.schemas.ts";
import { lwqlQueryRequestSchema } from "../analytics-lwql.trpc.ts";
import { langWatchQLQueryResultSchema, TRACE_SOURCES } from "../analytics.lwql.ts";
import { LWQL_MAX_NAMED_PROJECTS } from "../langwatch-ql-limits.ts";

const SQL = "SELECT 1";
const issuesOf = (input: unknown) => {
  const parsed = lwqlKeyStatementSchema.safeParse(input);

  return parsed.success ? [] : parsed.error.issues.map(({ message }) => message);
};

describe("given the key door's body", () => {
  /** @scenario "QP12b A list longer than the tenant capability is refused" */
  it("refuses more projects than the capability allows, naming the maximum", () => {
    const projects = Array.from({ length: LWQL_MAX_NAMED_PROJECTS + 1 }, (_, index) => `p${index}`);

    expect(issuesOf({ sql: SQL, projects })).toEqual([`projects holds at most 10000 ids`]);
    expect(issuesOf({ sql: SQL, projects: projects.slice(0, LWQL_MAX_NAMED_PROJECTS) })).toEqual(
      [],
    );
  });

  /** @scenario "QP12c An empty list of projects is refused" */
  it("refuses an empty list, with the message that names the rule", () => {
    expect(issuesOf({ sql: SQL, projects: [] })).toEqual(["projects must hold at least one id"]);
  });

  /** @scenario "QP08 An unknown source is refused at every door" */
  it("refuses a source outside the known ones, at the key door and the card door", () => {
    expect(issuesOf({ sql: SQL, sources: ["bogus"] }).length).toBeGreaterThan(0);
    expect(lwqlQueryRequestSchema.validate({ projectId: "p", sql: SQL, sources: ["bogus"] })).toBe(
      false,
    );
    for (const source of TRACE_SOURCES) {
      expect(issuesOf({ sql: SQL, sources: [source] })).toEqual([]);
    }
  });

  /** @scenario "QP22 A request from SDK 2.0.0 runs with the same rows" */
  it("accepts the body SDK 2.0.0 sends, with projectId and no projects or sources", () => {
    const parsed = lwqlKeyStatementSchema.safeParse({
      sql: SQL,
      parameters: { a: 1 },
      projectId: "project-1",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("projects");
    expect(parsed.data).not.toHaveProperty("sources");
  });

  /** @scenario "QP24 The OpenAPI document lists the added fields as optional" */
  it("takes projects and sources as optional fields", () => {
    expect(issuesOf({ sql: SQL })).toEqual([]);
    expect(lwqlKeyStatementSchema.shape.projects.isOptional()).toBe(true);
    expect(lwqlKeyStatementSchema.shape.sources.isOptional()).toBe(true);
  });
});

describe("given a result that carries params", () => {
  const RESULT = {
    columns: [],
    rows: [],
    statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
    diagnostics: [],
    followsTimeWindow: false,
    followsGranularity: false,
    params: { dashboard_context_projects: ["A"], days: 7, period: { start: "a", end: "b" } },
  };

  /** @scenario "QP18 tRPC, REST and MCP return equal params for the same run" */
  it("parses to the same params at the card door and the key door, which share one schema", () => {
    const card = langWatchQLQueryResultSchema.parse(RESULT);

    expect(card.params).toEqual(RESULT.params);
    expect(langWatchQLQueryResultSchema.validate({ ...RESULT, params: "all" })).toBe(false);
  });
});
