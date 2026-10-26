/**
 * The board client over /api/v1/boards, the board tools, and the one deprecation note the
 * dashboards tools give. Spec: modules/dashboard/specs/dashboards-v2.feature AC199s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initConfig, runWithConfig } from "../config.ts";
import {
  DASHBOARDS_DEPRECATION_NOTE,
  resetDashboardsDeprecation,
  withDashboardsDeprecationNote,
} from "../dashboards-deprecation.ts";
import {
  createBoard,
  createBoardWidget,
  deleteBoard,
  deleteBoardWidget,
  getBoard,
  getBoardWidget,
  listBoards,
  listBoardWidgets,
  updateBoard,
  updateBoardWidget,
} from "../langwatch-api-boards.js";
import { listDashboards } from "../langwatch-api-dashboards.ts";
import {
  handleCreateDashboardBoard,
  handleDeleteDashboardBoard,
  handleDeleteDashboardWidget,
  handleListBoardWidgets,
  handleRenameDashboardBoard,
} from "../tools/dashboard-boards.js";

const ENDPOINT = "https://app.example.com";
const board = {
  id: "b_1",
  name: "Usage",
  description: null,
  scope: "PROJECT",
  createdById: null,
  createdAt: "2026-10-26T00:00:00Z",
  updatedAt: "2026-10-26T00:00:00Z",
  platformUrl: `${ENDPOINT}/p/dashboards/b_1`,
};
const widget = {
  id: "w_1",
  name: "Traces",
  definition: { version: 1, code: "x", queries: [{ name: "q", sql: "SELECT 1" }] },
  dashboardId: "b_1",
};

type Call = { method: string; url: string; body: unknown };

function stubFetch({
  answer = () => board,
  headers = {},
}: { answer?: (call: Call) => unknown; headers?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
    const call = {
      method: init.method ?? "GET",
      url: url.slice(ENDPOINT.length),
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    };
    calls.push(call);
    const payload = answer(call);
    return payload === null
      ? new Response(null, { status: 204, headers })
      : new Response(JSON.stringify(payload), { status: 200, headers });
  }) as unknown as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  initConfig({ apiKey: "test-key", endpoint: ENDPOINT });
  resetDashboardsDeprecation();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("given the board client", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("calls /api/v1/boards with no project id in the path, with each verb and body", async () => {
    const calls = stubFetch({ answer: ({ method }) => (method === "DELETE" ? null : board) });

    await listBoards();
    await getBoard({ boardId: "b_1" });
    await createBoard({ name: "Usage" });
    await updateBoard({ boardId: "b_1", description: null });
    await deleteBoard({ boardId: "b_1" });
    await listBoardWidgets({ boardId: "b_1" });
    await createBoardWidget({ boardId: "b_1", name: "Traces", code: "x", queries: [] });
    await getBoardWidget({ boardId: "b_1", widgetId: "w_1" });
    await updateBoardWidget({ boardId: "b_1", widgetId: "w_1", name: "P95" });
    await deleteBoardWidget({ boardId: "b_1", widgetId: "w_1" });

    expect(calls).toEqual([
      { method: "GET", url: "/api/v1/boards", body: undefined },
      { method: "GET", url: "/api/v1/boards/b_1", body: undefined },
      { method: "POST", url: "/api/v1/boards", body: { name: "Usage" } },
      { method: "PATCH", url: "/api/v1/boards/b_1", body: { description: null } },
      { method: "DELETE", url: "/api/v1/boards/b_1", body: undefined },
      { method: "GET", url: "/api/v1/boards/b_1/widgets", body: undefined },
      {
        method: "POST",
        url: "/api/v1/boards/b_1/widgets",
        body: { name: "Traces", code: "x", queries: [] },
      },
      { method: "GET", url: "/api/v1/boards/b_1/widgets/w_1", body: undefined },
      { method: "PATCH", url: "/api/v1/boards/b_1/widgets/w_1", body: { name: "P95" } },
      { method: "DELETE", url: "/api/v1/boards/b_1/widgets/w_1", body: undefined },
    ]);
  });
});

describe("given the board tools", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("creates, renames and deletes a board, naming it in the answer", async () => {
    stubFetch({
      answer: ({ method }) =>
        method === "DELETE" ? { id: "b_1", name: "Usage" } : { ...board, name: "Usage" },
    });

    const created = await handleCreateDashboardBoard({ name: "Usage" });
    const renamed = await handleRenameDashboardBoard({ boardId: "b_1", name: "Usage" });
    const deleted = await handleDeleteDashboardBoard({ boardId: "b_1" });

    expect(created).toContain("**ID**: b_1");
    expect(renamed).toContain("Board updated.");
    expect(deleted).toContain('Board "Usage" deleted');
  });

  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("refuses a rename naming nothing without calling the API", async () => {
    const calls = stubFetch();

    await expect(handleRenameDashboardBoard({ boardId: "b_1" })).rejects.toThrow(/at least one/);
    expect(calls).toEqual([]);
  });

  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("lists a board's widgets and deletes one under that board", async () => {
    const calls = stubFetch({
      answer: ({ method }) => (method === "DELETE" ? null : { data: [widget] }),
    });

    const listed = await handleListBoardWidgets({ boardId: "b_1" });
    const deleted = await handleDeleteDashboardWidget({ boardId: "b_1", widgetId: "w_1" });

    expect(listed).toContain("**ID**: w_1");
    expect(deleted).toContain('Widget "w_1" deleted from board "b_1"');
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET /api/v1/boards/b_1/widgets",
      "DELETE /api/v1/boards/b_1/widgets/w_1",
    ]);
  });
});

describe("given the dashboards tools call /api/v1/dashboards", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("gives the note once, to stderr and in one tool result, when the answer is deprecated", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stubFetch({ answer: () => ({ data: [] }), headers: { Deprecation: "true" } });

    await listDashboards();
    const first = withDashboardsDeprecationNote("listed");
    await listDashboards();
    const second = withDashboardsDeprecationNote("listed");

    expect(first).toBe(`listed\n\n${DASHBOARDS_DEPRECATION_NOTE}`);
    expect(second).toBe("listed");
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(DASHBOARDS_DEPRECATION_NOTE).toContain("/api/v1/boards");
  });

  it("keeps the state per API key, so a flag-off session never gets another key's note", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const flagged = JSON.stringify(init.headers).includes("key-on");
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: flagged ? { Deprecation: "true" } : {},
      });
    }) as unknown as typeof fetch;
    const session = (apiKey: string) =>
      runWithConfig({ apiKey, endpoint: ENDPOINT }, async () => {
        await listDashboards();
        return withDashboardsDeprecationNote("listed");
      });

    const on = await session("key-on");
    const off = await session("key-off");
    const onAgain = await session("key-on");

    expect(on).toBe(`listed\n\n${DASHBOARDS_DEPRECATION_NOTE}`);
    expect(off).toBe("listed");
    expect(onAgain).toBe("listed");
  });

  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("gives no note when the answer carries no Deprecation header", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stubFetch({ answer: () => ({ data: [] }) });

    await listDashboards();

    expect(withDashboardsDeprecationNote("listed")).toBe("listed");
    expect(stderr).not.toHaveBeenCalled();
  });

  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("ignores a Deprecation header on a route other than /api/v1/dashboards", async () => {
    stubFetch({ answer: () => ({ data: [] }), headers: { Deprecation: "true" } });

    await listBoards();

    expect(withDashboardsDeprecationNote("listed")).toBe("listed");
  });
});
