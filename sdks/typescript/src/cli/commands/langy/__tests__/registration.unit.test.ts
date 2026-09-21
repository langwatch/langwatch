/**
 * How `langwatch langy` and `langwatch agent tunnel` are registered.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../../program";
import { INTERACTIVE_ONLY_MESSAGE, refuseStructuredOutput } from "../index";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant —
// stub it for the in-process test run (no bundler define under vitest).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const commandNamed = ({
  parent,
  name,
}: {
  parent: Command;
  name: string;
}): Command | undefined =>
  parent.commands.find((entry) => entry.name() === name);

describe("given the CLI program", () => {
  const program = buildProgram();

  describe("when the langy command is looked up", () => {
    it("registers it with the share-control flag and the help line", () => {
      const langy = commandNamed({ parent: program, name: "langy" });
      expect(langy).toBeDefined();
      expect(langy?.description()).toContain("Share this folder");
      const flags = langy?.options.map((option) => option.long) ?? [];
      expect(flags).toContain("--share-control");
    });
  });

  describe("when structured output is asked for", () => {
    /** @scenario "JSON output is refused with the reason" */
    it("refuses and says the command is an interactive session", () => {
      expect(refuseStructuredOutput({ output: "json" })).toBe(
        INTERACTIVE_ONLY_MESSAGE,
      );
      expect(INTERACTIVE_ONLY_MESSAGE).toContain("interactive session");
      expect(refuseStructuredOutput({ shareControl: true })).toBeNull();
    });
  });

  describe("when the tunnel command is looked up", () => {
    /** @scenario "The tunnel keeps its behaviour under its new name" */
    it("registers agent tunnel, with agent dev hidden beside it", () => {
      const agent = commandNamed({ parent: program, name: "agent" });
      expect(agent).toBeDefined();
      const tunnel = commandNamed({ parent: agent!, name: "tunnel" });
      const dev = commandNamed({ parent: agent!, name: "dev" });
      expect(tunnel).toBeDefined();
      expect(dev).toBeDefined();

      const flagsOf = (command: Command) =>
        command.options.map((option) => option.long).sort();
      expect(flagsOf(dev!)).toEqual(flagsOf(tunnel!));
      expect(flagsOf(tunnel!)).toContain("--port");

      const helpText = agent!.helpInformation();
      expect(helpText).toContain("tunnel");
      expect(helpText).not.toMatch(/^\s+dev\b/m);
    });
  });
});
