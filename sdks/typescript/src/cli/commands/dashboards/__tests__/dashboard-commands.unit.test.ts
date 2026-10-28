/**
 * The `langwatch dashboard` and `langwatch analytics-report` command trees, read off the live
 * commander program. Spec: specs/features/dashboard-cli.feature,
 * modules/dashboard/specs/dashboards-v2.feature (AC199s, AC199x)
 */
import type { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";

import { isOutputAware } from "../../../utils/output";

vi.mock("../../../utils/apiKey", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCredentials: vi.fn(async () => ({ apiKey: "k", source: "env", endpoint: "e" })),
}));

// program.ts reads the tsup-injected __CLI_VERSION__ build constant, which vitest does not define.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const child = (parent: Command | undefined, name: string) =>
  parent?.commands.find((command) => command.name() === name);
const names = (parent: Command | undefined) => parent?.commands.map((command) => command.name());

describe("the langwatch dashboard command group", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  /** @scenario "The dashboard group manages dashboards and the widgets on them" */
  it("offers dashboard and widget verbs, each speaking the output contract", async () => {
    const { buildProgram } = await import("../../../program.js");
    const dashboard = child(buildProgram(), "dashboard");
    const widget = child(dashboard, "widget");
    const leaves = [
      ...["list", "get", "create", "update", "delete"].map((verb) => child(dashboard, verb)),
      ...["schema", "list", "get", "add", "update", "delete"].map((verb) => child(widget, verb)),
    ];

    expect({
      dashboard: names(dashboard),
      widget: names(widget),
      get: child(dashboard, "get")?.registeredArguments.map((arg) => arg.name()),
      add: child(widget, "add")?.registeredArguments.map((arg) => arg.name()),
      outputAware: leaves.every((leaf) => leaf !== undefined && isOutputAware(leaf)),
    }).toEqual({
      dashboard: ["list", "get", "create", "update", "delete", "widget"],
      widget: ["schema", "list", "get", "add", "update", "delete"],
      get: ["dashboardId"],
      add: ["dashboardId"],
      outputAware: true,
    });
  });

  /** @scenario "A dashboard update refuses a new description and clearing it at once" */
  it("refuses --description together with --clear-description before any request", async () => {
    const { buildProgram } = await import("../../../program.js");
    const program = buildProgram();
    const update = child(child(program, "dashboard"), "update")!;
    update.exitOverride().configureOutput({ writeErr: () => undefined });

    const failure = await program
      .parseAsync([
        "node",
        "langwatch",
        "dashboard",
        "update",
        "d_1",
        "--description",
        "x",
        "--clear-description",
      ])
      .then(
        () => undefined,
        (error: CommanderError) => error.code,
      );

    expect(failure).toBe("commander.conflictingOption");
  });
});

describe("the old command names", () => {
  /** @scenario "AC199x Names: the CLI has one dashboard tree and no old command names" */
  it("has no dashboards, dashboard-widget or analytics-reports group, and analytics-report", async () => {
    const { buildProgram } = await import("../../../program.js");
    const program = buildProgram();

    expect({
      old: ["dashboards", "dashboard-widget", "analytics-reports"].filter((name) =>
        child(program, name),
      ),
      reports: names(child(program, "analytics-report")),
    }).toEqual({
      old: [],
      reports: ["list", "get", "update", "create", "delete"],
    });
  });
});
