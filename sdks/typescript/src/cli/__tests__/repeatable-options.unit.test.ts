/**
 * Commander hands a custom option parser `undefined` as the previous value the first time the
 * flag appears. A collecting parser without a default threw "is not iterable" on the first
 * `--scope` (`vk create --scope project:x`); every parser must accept a first value.
 */
import { describe, expect, it } from "vitest";

import { buildProgram } from "../program";
import { commandPath, leafCommands } from "../utils/projectOption";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant,
// which no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

describe("given every option with its own parser", () => {
  describe("when the flag is given for the first time", () => {
    it("parses the value instead of throwing", () => {
      const failures: string[] = [];
      for (const leaf of leafCommands(buildProgram({ bin: "langwatch" }))) {
        for (const option of leaf.options) {
          if (!option.parseArg || option.defaultValue !== undefined) continue;
          try {
            option.parseArg("x", undefined);
          } catch (error) {
            // A refused value (choices, a number) is the parser working; a TypeError is the defect.
            if (error instanceof TypeError) failures.push(`${commandPath(leaf)} ${option.long}`);
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it("collects the first --scope of vk create into a list", () => {
      const create = leafCommands(buildProgram({ bin: "langwatch" })).find(
        (leaf) => commandPath(leaf) === "virtual-keys create",
      );
      const scope = create?.options.find((option) => option.long === "--scope");

      expect(scope?.parseArg?.("project:p1", undefined)).toEqual(["project:p1"]);
    });
  });
});
