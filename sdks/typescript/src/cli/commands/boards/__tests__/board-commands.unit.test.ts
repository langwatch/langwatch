/**
 * The `langwatch dashboards` command tree, read off the live commander program.
 * Spec: modules/dashboard/specs/dashboards-v2.feature (AC199s)
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { isOutputAware } from "../../../utils/output";

// program.ts reads the tsup-injected __CLI_VERSION__ build constant, which vitest does not define.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const child = (parent: Command | undefined, name: string) =>
  parent?.commands.find((command) => command.name() === name);

describe("the langwatch dashboards command group", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("offers board and widget verbs, each speaking the output contract", async () => {
    const { buildProgram } = await import("../../../program.js");
    const boards = child(buildProgram(), "dashboards");
    const widgets = child(boards, "widgets");
    const leaves = [
      ...["list", "get", "create", "update", "delete"].map((verb) => child(boards, verb)),
      ...["list", "get", "create", "update", "delete"].map((verb) => child(widgets, verb)),
    ];

    expect({
      boards: boards?.commands.map((command) => command.name()),
      widgets: widgets?.commands.map((command) => command.name()),
      outputAware: leaves.every((leaf) => leaf !== undefined && isOutputAware(leaf)),
    }).toEqual({
      boards: ["list", "get", "create", "update", "delete", "widgets"],
      widgets: ["list", "get", "create", "update", "delete"],
      outputAware: true,
    });
  });
});
