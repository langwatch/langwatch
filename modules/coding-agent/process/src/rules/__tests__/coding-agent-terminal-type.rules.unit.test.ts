/**
 * @vitest-environment node
 * @see modules/coding-agent/specs/coding-agent-session-stored.feature
 */
import { codingTerminalSchema } from "@langwatch/coding-agent-contract";
import { describe, expect, it } from "vitest";

import { codingTerminalOf } from "../coding-agent-terminal-type.rules.ts";

describe("codingTerminalOf", () => {
  /** @scenario "A client's terminal string reaches peers only as one of a closed set" */
  it.each([
    ["vscode", "vscode"],
    ["iTerm.app", "iterm"],
    ["Apple_Terminal", "apple_terminal"],
    ["WarpTerminal", "warp"],
    ["pycharm", "jetbrains"],
    ["xterm-kitty", "kitty"],
    ["xterm-256color", "xterm"],
  ])("names %s as %s", (reported, terminal) => {
    expect(codingTerminalOf(reported)).toBe(terminal);
  });

  it.each(["my-terminal; drop table", "constructor", "x".repeat(10_000)])(
    "names an unknown string as other",
    (reported) => {
      expect(codingTerminalOf(reported)).toBe("other");
    },
  );

  it.each([null, "", "   "])("names no terminal for %j", (reported) => {
    expect(codingTerminalOf(reported)).toBeNull();
  });

  it("only ever answers a name of the contract's set", () => {
    for (const reported of ["vscode", "xterm-256color", "unknown"]) {
      expect(codingTerminalSchema.options).toContain(codingTerminalOf(reported));
    }
  });
});
