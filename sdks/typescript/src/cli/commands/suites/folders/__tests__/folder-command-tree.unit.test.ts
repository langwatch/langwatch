/**
 * Where the folder commands live in the command tree.
 *
 * A folder is a suite, so its commands are registered on the `suite` group. A
 * top-level `folder` group would say the opposite, and would also break the
 * feature-map drift guard, which reads every `program.command("<word>")`.
 *
 * Spec: specs/features/suite-cli.feature
 */
import { describe, expect, it } from "vitest";

import { buildProgram } from "../../../../program";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

describe("the folder commands, given the CLI command tree", () => {
  const program = buildProgram();
  const topLevel = program.commands.map((command) => command.name());
  const suite = program.commands.find((command) => command.name() === "suite");

  /** @scenario "Folder commands stay nested under the suite group" */
  it("registers no top-level folder group", () => {
    expect(topLevel).not.toContain("folder");
  });

  /** @scenario "Folder commands stay nested under the suite group" */
  it("registers the folder group under suite", () => {
    expect(suite).toBeDefined();
    const suiteSubcommands = suite!.commands.map((command) => command.name());
    expect(suiteSubcommands).toContain("folder");

    const folder = suite!.commands.find(
      (command) => command.name() === "folder",
    );
    expect(folder!.commands.map((command) => command.name())).toEqual([
      "list",
      "create",
      "rename",
      "delete",
    ]);
  });
});
