/**
 * The `langwatch dashboards` command tree, and the old names kept as deprecated aliases, read off
 * the live commander program. Spec: modules/dashboard/specs/dashboards-v2.feature (AC199s, AC199x)
 */
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsReportsApiService } from "@/client-sdk/services/analytics-reports/analytics-reports-api.service";

import { isOutputAware } from "../../../utils/output";

vi.mock(
  "@/client-sdk/services/analytics-reports/analytics-reports-api.service",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    AnalyticsReportsApiService: vi.fn(),
  }),
);
vi.mock("../../../utils/apiKey", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCredentials: vi.fn(async () => ({ apiKey: "k", source: "env", endpoint: "e" })),
}));
vi.mock("ora", () => ({
  default: () => ({ start: vi.fn().mockReturnThis(), succeed: vi.fn(), fail: vi.fn() }),
}));

// program.ts reads the tsup-injected __CLI_VERSION__ build constant, which vitest does not define.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const child = (parent: Command | undefined, name: string) =>
  parent?.commands.find((command) => command.name() === name);
const names = (parent: Command | undefined) => parent?.commands.map((command) => command.name());

describe("the langwatch dashboards command group", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("offers dashboard and widget verbs, each speaking the output contract", async () => {
    const { buildProgram } = await import("../../../program.js");
    const dashboards = child(buildProgram(), "dashboards");
    const widgets = child(dashboards, "widgets");
    const leaves = [
      ...["list", "get", "create", "update", "delete"].map((verb) => child(dashboards, verb)),
      ...["list", "get", "create", "update", "delete"].map((verb) => child(widgets, verb)),
    ];

    expect({
      dashboards: names(dashboards),
      widgets: names(widgets),
      arguments: child(dashboards, "get")?.registeredArguments.map((arg) => arg.name()),
      outputAware: leaves.every((leaf) => leaf !== undefined && isOutputAware(leaf)),
    }).toEqual({
      dashboards: ["list", "get", "create", "update", "delete", "widgets"],
      widgets: ["list", "get", "create", "update", "delete"],
      arguments: ["dashboardId"],
      outputAware: true,
    });
  });
});

describe("the old command names", () => {
  const stderr = vi.fn();

  beforeEach(() => {
    vi.mocked(AnalyticsReportsApiService).mockImplementation(function () {
      return { list: async () => ({ data: [] }) } as unknown as AnalyticsReportsApiService;
    });
    vi.spyOn(console, "error").mockImplementation(stderr);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    stderr.mockReset();
    vi.restoreAllMocks();
  });

  /** @scenario "AC199x Names: the CLI keeps its old command names as deprecated aliases" */
  it("runs `dashboard` as `analytics-reports`, with one deprecation line on stderr", async () => {
    const { buildProgram } = await import("../../../program.js");
    const program = buildProgram();

    await program.parseAsync(["node", "langwatch", "analytics-reports", "list"]);
    const quiet = stderr.mock.calls.length;
    await program.parseAsync(["node", "langwatch", "dashboard", "list"]);

    expect({
      verbs: names(child(program, "dashboard")),
      inHelp: /^\s+dashboard\s/m.test(program.helpInformation()),
      quiet,
      notice: stderr.mock.calls.map(([line]) => line),
    }).toEqual({
      verbs: names(child(program, "analytics-reports")),
      inHelp: false,
      quiet: 0,
      notice: ["`langwatch dashboard` is deprecated; use `langwatch analytics-reports` instead."],
    });
  });

  /** @scenario "AC199x Names: the CLI keeps its old command names as deprecated aliases" */
  it("keeps `dashboard-widget boards` working but out of the help", async () => {
    const { buildProgram } = await import("../../../program.js");
    const widget = child(buildProgram(), "dashboard-widget");
    const help = widget?.helpInformation() ?? "";

    expect({
      both: [child(widget, "dashboards"), child(widget, "boards")].every(
        (command) => command !== undefined && isOutputAware(command),
      ),
      listsDashboards: /^\s+dashboards\s/m.test(help),
      listsBoards: /^\s+boards\s/m.test(help),
    }).toEqual({ both: true, listsDashboards: true, listsBoards: false });
  });
});
