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

import { getDashboardCommand, updateDashboardCommand } from "../dashboards";

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

/** The JSON bodies the requests sent, optionally only those of one method. */
async function sentBodies(method?: string): Promise<unknown[]> {
  const calls = fetchMock.mock.calls as unknown as [Request][];
  const requests = calls
    .map(([request]) => request)
    .filter((request) => method === undefined || request.method === method);
  return Promise.all(requests.map(async (request) => request.clone().json()));
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
  it("sends null to reset without reading the board", async () => {
    await updateDashboardCommand("dashboard_v2", { resetLangyTraces: true });

    expect(await sentBodies()).toEqual([{ excludedOrigins: null }]);
  });

  /** @scenario "AC200f Langy setting: the CLI, MCP and Python SDK read and set the origins a board leaves out" */
  it.each([
    { stored: null, include: [], exclude: ["langy"] },
    { stored: [], include: [], exclude: ["langy"] },
    { stored: ["langy"], include: [], exclude: ["langy"] },
    { stored: ["eval"], include: ["eval"], exclude: ["eval", "langy"] },
    { stored: ["langy", "eval"], include: ["eval"], exclude: ["eval", "langy"] },
  ])("keeps the other origins of $stored", async ({ stored, include, exclude }) => {
    fetchMock.mockImplementation(async () => json({ ...dashboard, excludedOrigins: stored }));

    await updateDashboardCommand("dashboard_v2", { includeLangyTraces: true });
    await updateDashboardCommand("dashboard_v2", { excludeLangyTraces: true });

    expect(await sentBodies("PATCH")).toEqual([
      { excludedOrigins: include },
      { excludedOrigins: exclude },
    ]);
  });

  /** @scenario "AC200f Langy setting: the CLI, MCP and Python SDK read and set the origins a board leaves out" */
  it("sends the setting together with a rename", async () => {
    await updateDashboardCommand("dashboard_v2", { name: "Ops", includeLangyTraces: true });

    expect(await sentBodies("PATCH")).toEqual([{ name: "Ops", excludedOrigins: [] }]);
  });

  /** @scenario "AC200f Langy setting: the CLI, MCP and Python SDK read and set the origins a board leaves out" */
  it.each([
    { stored: null, line: "default (left out, included in a personal project)" },
    { stored: [], line: "included" },
    { stored: ["langy"], line: "left out" },
    { stored: ["eval"], line: "included; also leaves out eval" },
    { stored: ["langy", "eval"], line: "left out; also leaves out eval" },
  ])("prints the Langy traces line for $stored", async ({ stored, line }) => {
    fetchMock.mockImplementation(async () => json({ ...dashboard, excludedOrigins: stored }));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await getDashboardCommand("dashboard_v2");
    expect(result).toMatchObject({ data: { excludedOrigins: stored } });
    if (result) result.table();

    const printed = log.mock.calls.map(([text]) => String(text));
    expect(printed.some((text) => text.includes("Langy traces:") && text.endsWith(line))).toBe(
      true,
    );
  });
});
