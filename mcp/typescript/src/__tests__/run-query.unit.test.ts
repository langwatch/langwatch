/**
 * The run_query tool: it sends the projects and sources it is given, shows what the run was
 * bound to, and tells an agent whose key names no project how to fix it.
 * @see specs/lwql/query-params.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-query.ts", () => ({ runQuery: vi.fn() }));

import { runQuery } from "../langwatch-api-query.ts";
import { LangWatchApiError } from "../langwatch-api.ts";
import { handleRunQuery } from "../tools/run-query.ts";

const mockRunQuery = vi.mocked(runQuery);

const RESULT = {
  columns: [{ name: "n", type: "UInt64" }],
  rows: [{ n: 3 }],
  statistics: { elapsedMs: 4, rowsRead: 3, bytesRead: 10, rowsReturned: 1 },
  truncated: false,
  diagnostics: [],
};

beforeEach(() => vi.clearAllMocks());

describe("given run_query is called with projects and sources", () => {
  /** @scenario "QP20 The MCP tool takes the parameters and shows params to the agent" */
  it("passes them on and shows the params the platform answered with", async () => {
    mockRunQuery.mockResolvedValue({
      ...RESULT,
      params: { dashboard_context_projects: ["A"] },
    });

    const text = await handleRunQuery({
      sql: "SELECT 1",
      projects: ["A"],
      sources: ["application"],
    });

    expect(mockRunQuery).toHaveBeenCalledWith({
      sql: "SELECT 1",
      projects: ["A"],
      sources: ["application"],
    });
    expect(text).toContain('"dashboard_context_projects": [\n    "A"\n  ]');
  });

  /** @scenario "QP29 Every door returns the limiting diagnostics" */
  it("prints the limiting diagnostics under the rows", async () => {
    mockRunQuery.mockResolvedValue({
      ...RESULT,
      diagnostics: [
        {
          code: "SHARE_WINDOW_LIMITED",
          message: "Some projects share data only from a date, so earlier rows are not included",
        },
      ],
    });

    expect(await handleRunQuery({ sql: "SELECT 1" })).toContain(
      "SHARE_WINDOW_LIMITED: Some projects share data only from a date",
    );
  });

  it("shows the sources when the statement read them", async () => {
    mockRunQuery.mockResolvedValue({
      ...RESULT,
      params: { dashboard_context_sources: ["application", "langy"] },
    });

    expect(await handleRunQuery({ sql: "SELECT 1" })).toContain('"application",\n    "langy"');
  });
});

describe("given the platform asks for the projects", () => {
  /** @scenario "QP03e The CLI and the MCP tool tell the user to pass the projects" */
  it("tells the agent to pass `projects`, with no project id", async () => {
    mockRunQuery.mockRejectedValue(
      new LangWatchApiError("Name the projects to query", 422, "{}", { code: "projects_required" }),
    );

    const refusal = await handleRunQuery({ sql: "SELECT 1" }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe(
      'Name the projects to query: pass `projects`, a list of project ids, or "all"',
    );
  });
});

describe("given the platform says the key reads no project", () => {
  /** @scenario "QP03j A key that reads no project is told so, not asked to name one" */
  it("passes the platform's message through instead of asking for projects", async () => {
    mockRunQuery.mockRejectedValue(
      new LangWatchApiError("This key reads no project. Ask an admin", 422, "{}", {
        code: "projects_unreadable",
      }),
    );

    const refusal = await handleRunQuery({ sql: "SELECT 1" }).catch((error: unknown) => error);

    expect((refusal as Error).message).toContain("reads no project");
  });
});

describe('given run_query is called with projects "all"', () => {
  /** @scenario "QP03f projects accepts the word all for every project the caller can read" */
  it("sends the string, not a list, and shows the projects the platform echoed", async () => {
    mockRunQuery.mockResolvedValue({
      ...RESULT,
      params: { dashboard_context_projects: ["A", "B"] },
    });

    const text = await handleRunQuery({ sql: "SELECT 1", projects: "all" });

    expect(mockRunQuery).toHaveBeenCalledWith({ sql: "SELECT 1", projects: "all" });
    expect(text).toContain('"dashboard_context_projects"');
  });
});
