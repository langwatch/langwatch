/**
 * Spec: modules/dashboard/specs/dashboards-v2.feature (AC199l: the CLI reads a board under the key's own project)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/internal/http/langwatchFetch", () => ({ langwatchFetch: fetchMock }));
vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "k", source: "env", endpoint: "e" })),
}));
vi.mock("ora", () => ({
  default: () => ({ start: vi.fn().mockReturnThis(), succeed: vi.fn(), fail: vi.fn() }),
}));

import { getDashboardCommand } from "../get";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const board = {
  id: "dashboard_v2",
  name: "Ops board",
  description: null,
  scope: "PROJECT",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/p/analytics/boards/dashboard_v2",
};

describe("getDashboardCommand() with only LANGWATCH_API_KEY", () => {
  beforeEach(() => {
    vi.stubEnv("LANGWATCH_API_KEY", "key");
    vi.stubEnv("LANGWATCH_PROJECT_ID", "");
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  /** @scenario "AC8c An agent reads a Dashboards board by its id" */
  it("returns the board held under the project the key belongs to", async () => {
    fetchMock.mockImplementation(async (input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/v1/me/project") return json(200, { id: "key_project" });
      if (pathname === "/api/v1/projects/key_project/analytics/boards/dashboard_v2")
        return json(200, board);
      return json(404, { error: "Dashboard not found" });
    });

    const result = await getDashboardCommand("dashboard_v2");

    expect(result).toMatchObject({ data: { id: "dashboard_v2", name: "Ops board" } });
  });
});
