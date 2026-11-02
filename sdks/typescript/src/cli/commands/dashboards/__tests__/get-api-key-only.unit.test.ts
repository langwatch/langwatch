/**
 * `langwatch dashboard get` with only an API key reads /api/v1/dashboards, where the project
 * comes from the key, and nothing else. Spec: modules/dashboard/specs/dashboards-v2.feature
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

import { getDashboardCommand } from "../dashboards";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const dashboard = {
  id: "dashboard_v2",
  name: "Ops",
  description: null,
  scope: "PROJECT",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/p/dashboards/dashboard_v2",
};

describe("getDashboardCommand() with only LANGWATCH_API_KEY", () => {
  beforeEach(() => {
    vi.stubEnv("LANGWATCH_API_KEY", "key");
    vi.stubEnv("LANGWATCH_PROJECT_ID", "");
    fetchMock.mockReset();
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** @scenario "AC8c An agent reads a Dashboards board by its id" */
  it("returns the dashboard from /api/v1/dashboards", async () => {
    fetchMock.mockImplementation(async (input: Request) =>
      new URL(input.url).pathname === "/api/v1/dashboards/dashboard_v2"
        ? json(200, dashboard)
        : json(404, { error: "Dashboard not found" }),
    );

    const result = await getDashboardCommand("dashboard_v2");

    expect(result).toMatchObject({ data: { id: "dashboard_v2", name: "Ops" } });
  });

  /** @scenario "AC8c An agent reads a Dashboards board by its id" */
  it("fails on an Analytics Report's id after one request, never asking the Reports API", async () => {
    fetchMock.mockImplementation(async () => json(404, { error: "Dashboard not found" }));

    await expect(getDashboardCommand("dashboard_v1")).rejects.toThrow("process.exit(1)");
    expect(fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
      "/api/v1/dashboards/dashboard_v1",
    ]);
  });
});
