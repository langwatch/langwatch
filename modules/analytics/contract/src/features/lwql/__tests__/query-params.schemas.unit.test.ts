/**
 * The wire shape of a run's projects and sources: what each door accepts and refuses.
 * @see specs/lwql/query-params.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { lwqlKeyStatementSchema } from "../analytics-lwql.schemas.ts";
import { lwqlQueryRequestSchema } from "../analytics-lwql.trpc.ts";
import { langWatchQLQueryResultSchema, TRACE_SOURCES } from "../analytics.lwql.ts";
import { LWQL_MAX_MEMBER_PROJECTS, LWQL_MAX_NAMED_PROJECTS } from "../langwatch-ql-limits.ts";
import { LangWatchQLReservedParameterSuppliedError } from "../langwatch-ql.errors.ts";

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

  /** @scenario "QP22b A reader written before params parses a result that carries them" */
  it("is read by a reader that knows only the fields of 2.0.0, with the same rows", () => {
    const before = z.object({
      columns: z.array(z.object({ name: z.string(), type: z.string() })),
      rows: z.array(z.record(z.string(), z.unknown())),
      statistics: z.object({ rowsReturned: z.number() }),
    });
    const wire = JSON.parse(
      JSON.stringify({
        ...RESULT,
        columns: [{ name: "n", type: "UInt64" }],
        rows: [{ n: 3 }],
        diagnostics: [{ code: "SOURCES_IGNORED", message: "m" }],
      }),
    );

    expect(before.parse(wire).rows).toEqual([{ n: 3 }]);
    expect(before.parse(wire)).not.toHaveProperty("params");
  });
});

describe("given the member door's body", () => {
  /** @scenario "AC207c Project: a query stores at most as many projects as a member's list may hold" */
  it("refuses more projects than a member's list may hold, naming the maximum", () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `p${index}`);
    const parse = (projects: string[]) =>
      lwqlQueryRequestSchema.safeParse({ projectId: "p", sql: SQL, projects });

    expect(parse(ids(LWQL_MAX_MEMBER_PROJECTS)).success).toBe(true);
    const refused = parse(ids(LWQL_MAX_MEMBER_PROJECTS + 1));
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe(
      `projects holds at most ${LWQL_MAX_MEMBER_PROJECTS} ids`,
    );
  });
});

describe("given a request that supplies a list name for itself", () => {
  it("tells the caller which request field to send", () => {
    const error = new LangWatchQLReservedParameterSuppliedError([
      "dashboard_context_projects",
      "dashboard_context_sources",
    ]);

    expect(error.message).toContain("the `projects` field and the `sources` field");
  });
});
