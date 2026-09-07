/**
 * nanoid's alphabet includes "-", so a dashboard/chart/dashboard-widget id can
 * legitimately start with a dash (e.g. `-L4zZkoUV0wTwci1YiTtb`, seen live on a
 * preview box). Commander reads a leading-dash positional as an unknown
 * option and rejects the call before the command's action ever runs — 4 of 9
 * Langy tool calls in one turn failed this way.
 *
 * Exercised through `buildProgram().parseAsync`, the way a real invocation is
 * parsed, rather than by calling the command implementation directly: the bug
 * lives in how program.ts wires the positional/option, not in the
 * implementation, so a test that skips commander's own parsing would pass
 * against a fix that does nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const DASH_LED_ID = "-L4zZkoUV0wTwci1YiTtb";

vi.mock("../commands/dashboard-widgets/get.js", () => ({
  getDashboardWidgetCommand: vi.fn(),
}));
vi.mock("../commands/dashboard-widgets/update.js", () => ({
  updateDashboardWidgetCommand: vi.fn(),
}));
vi.mock("../commands/dashboard-widgets/delete.js", () => ({
  deleteDashboardWidgetCommand: vi.fn(),
}));
vi.mock("../commands/dashboard-widgets/pin.js", () => ({
  pinDashboardWidgetCommand: vi.fn(),
}));
vi.mock("../commands/dashboards/get.js", () => ({
  getDashboardCommand: vi.fn(),
}));
vi.mock("../commands/charts/get.js", () => ({
  getChartCommand: vi.fn(),
}));

(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  // Thrown, not recorded: process.exit never returns in the real CLI, so a
  // mock that returns would let the action fall through to call the
  // implementation with an undefined id — masking exactly the bug this file
  // guards against.
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const parse = async (argv: string[]): Promise<void> => {
  const { buildProgram } = await import("../program.js");
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(argv, { from: "user" });
};

describe("a dashboard-widget id starting with '-'", () => {
  describe("given --id", () => {
    it("reaches get", async () => {
      const { getDashboardWidgetCommand } = await import("../commands/dashboard-widgets/get.js");
      await parse(["dashboard-widget", "get", "--id", DASH_LED_ID]);
      expect(getDashboardWidgetCommand).toHaveBeenCalledWith(DASH_LED_ID, expect.anything());
    });

    it("reaches update", async () => {
      const { updateDashboardWidgetCommand } = await import("../commands/dashboard-widgets/update.js");
      await parse(["dashboard-widget", "update", "--id", DASH_LED_ID, "--name", "Renamed"]);
      expect(updateDashboardWidgetCommand).toHaveBeenCalledWith(
        DASH_LED_ID,
        expect.objectContaining({ name: "Renamed" }),
      );
    });

    it("reaches delete", async () => {
      const { deleteDashboardWidgetCommand } = await import("../commands/dashboard-widgets/delete.js");
      await parse(["dashboard-widget", "delete", "--id", DASH_LED_ID]);
      expect(deleteDashboardWidgetCommand).toHaveBeenCalledWith(DASH_LED_ID, expect.anything());
    });

    it("reaches pin", async () => {
      const { pinDashboardWidgetCommand } = await import("../commands/dashboard-widgets/pin.js");
      await parse(["dashboard-widget", "pin", "--id", DASH_LED_ID, "--dashboard", "My Dashboard"]);
      expect(pinDashboardWidgetCommand).toHaveBeenCalledWith(
        DASH_LED_ID,
        expect.objectContaining({ dashboard: "My Dashboard" }),
      );
    });
  });

  describe("given the positional after a '--' separator", () => {
    it("reaches get without needing --id", async () => {
      const { getDashboardWidgetCommand } = await import("../commands/dashboard-widgets/get.js");
      await parse(["dashboard-widget", "get", "--", DASH_LED_ID]);
      expect(getDashboardWidgetCommand).toHaveBeenCalledWith(DASH_LED_ID, expect.anything());
    });
  });

  describe("given neither the positional nor --id", () => {
    it("exits 1 instead of calling the implementation", async () => {
      const { getDashboardWidgetCommand } = await import("../commands/dashboard-widgets/get.js");
      await expect(parse(["dashboard-widget", "get"])).rejects.toThrow(ProcessExitError);
      expect(getDashboardWidgetCommand).not.toHaveBeenCalled();
    });
  });

  describe("a normal id (no leading dash)", () => {
    it("still works via the positional, unchanged", async () => {
      const { getDashboardWidgetCommand } = await import("../commands/dashboard-widgets/get.js");
      await parse(["dashboard-widget", "get", "widget-123"]);
      expect(getDashboardWidgetCommand).toHaveBeenCalledWith("widget-123", expect.anything());
    });
  });
});

describe("sibling commands sharing the same nanoid id shape", () => {
  it("dashboard get accepts --id for a dash-led id", async () => {
    const { getDashboardCommand } = await import("../commands/dashboards/get.js");
    await parse(["dashboard", "get", "--id", DASH_LED_ID]);
    expect(getDashboardCommand).toHaveBeenCalledWith(DASH_LED_ID);
  });

  it("chart get accepts --id for a dash-led id", async () => {
    const { getChartCommand } = await import("../commands/charts/get.js");
    await parse(["chart", "get", "--id", DASH_LED_ID]);
    expect(getChartCommand).toHaveBeenCalledWith(DASH_LED_ID, expect.anything());
  });
});
