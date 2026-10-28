/**
 * `langwatch dashboard update` Langy traces flags and `dashboard get` over /api/v1/dashboards.
 * Spec: modules/dashboard/specs/dashboards-v2.feature AC200f
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

import { describeLangyTraces, getDashboardCommand, updateDashboardCommand } from "../dashboards";

const dashboard = {
  id: "dashboard_v2",
  name: "Ops",
  description: null,
  scope: "PROJECT",
  excludedOrigins: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/p/dashboards/dashboard_v2",
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** The JSON bodies the requests sent. */
async function sentBodies(): Promise<unknown[]> {
  const calls = fetchMock.mock.calls as unknown as [Request][];
  return Promise.all(calls.map(async ([request]) => request.clone().json()));
}

describe("langwatch dashboard update, Langy traces flags", () => {
  beforeEach(() => {
    vi.stubEnv("LANGWATCH_API_KEY", "key");
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json(dashboard));
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** @scenario "AC200f Langy setting: the CLI, MCP and Python SDK read and set the origins a board leaves out" */
  it("sends [] to include, [langy] to leave out and null to reset", async () => {
    await updateDashboardCommand("dashboard_v2", { includeLangyTraces: true });
    await updateDashboardCommand("dashboard_v2", { excludeLangyTraces: true });
    await updateDashboardCommand("dashboard_v2", { resetLangyTraces: true });

    expect(await sentBodies()).toEqual([
      { excludedOrigins: [] },
      { excludedOrigins: ["langy"] },
      { excludedOrigins: null },
    ]);
  });

  /** @scenario "AC200f Langy setting: the CLI, MCP and Python SDK read and set the origins a board leaves out" */
  it("sends the setting together with a rename", async () => {
    await updateDashboardCommand("dashboard_v2", { name: "Ops", includeLangyTraces: true });

    expect(await sentBodies()).toEqual([{ name: "Ops", excludedOrigins: [] }]);
  });

  /** @scenario "AC200f Langy setting: the CLI, MCP and Python SDK read and set the origins a board leaves out" */
  it("returns the stored setting from get and words it for the table", async () => {
    fetchMock.mockImplementation(async () => json({ ...dashboard, excludedOrigins: [] }));

    const result = await getDashboardCommand("dashboard_v2");

    expect(result).toMatchObject({ data: { excludedOrigins: [] } });
    expect(describeLangyTraces(null)).toContain("default");
    expect(describeLangyTraces([])).toBe("included");
    expect(describeLangyTraces(["langy"])).toBe("left out");
    expect(describeLangyTraces(["eval"])).toBe("included; also leaves out eval");
  });
});
