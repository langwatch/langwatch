import { describe, expect, it } from "vitest";

import { parseUpgradeArgs, UpgradeArgumentError } from "../upgrade.ts";

describe("parseUpgradeArgs()", () => {
  /** @scenario "upgrade takes old-writers-gone and pre-roster-rollback, and nothing after them" */
  it("parses each override as its own subcommand and refuses an argument after it", () => {
    expect(parseUpgradeArgs({ args: ["old-writers-gone"] })).toEqual({
      command: "old-writers-gone",
    });
    expect(parseUpgradeArgs({ args: ["pre-roster-rollback"] })).toEqual({
      command: "pre-roster-rollback",
    });
    for (const command of ["old-writers-gone", "pre-roster-rollback"]) {
      const refusal = (() => {
        try {
          return parseUpgradeArgs({ args: [command, "--json"] });
        } catch (error) {
          return error;
        }
      })();
      expect(refusal).toBeInstanceOf(UpgradeArgumentError);
      expect(refusal).toMatchObject({ code: "unknown_upgrade_argument", argument: "--json" });
    }
  });
});
