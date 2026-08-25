/**
 * The "Coding assistants:" section of `langwatch --help` is hand-written
 * (the commands themselves are registered hidden, so commander cannot
 * render them as a group at the bottom). Hand-written means it can
 * drift in both directions: a wrapper registered without a footer line
 * is invisible in --help, and a footer line for a renamed or visible
 * command lies. This suite pins the footer and the registrations to
 * each other.
 */
import type { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { buildProgram } from "../program";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant,
// which no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

function helpOutput(program: Command): string {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  try {
    program.outputHelp();
  } finally {
    spy.mockRestore();
  }
  return out;
}

/** First word of each line in the footer section, until the blank line. */
function footerEntries(help: string): string[] {
  const lines = help.split("\n");
  const start = lines.findIndex((l) => l.trim() === "Coding assistants:");
  expect(start, "the Coding assistants footer section is missing").toBeGreaterThan(-1);
  const entries: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break;
    entries.push(line.trim().split(/\s+/)[0]!);
  }
  return entries;
}

describe("the coding-assistants help footer", () => {
  it("lists every launcher and setup command, launchers first", () => {
    const help = helpOutput(buildProgram());

    expect(footerEntries(help)).toEqual([
      "claude",
      "codex",
      "copilot",
      "code",
      "cursor",
      "gemini",
      "opencode",
      "copilot-app",
      "instrument",
    ]);
  });

  it("names only registered commands, every one of them hidden", () => {
    const program = buildProgram();
    const help = helpOutput(program);

    for (const name of footerEntries(help)) {
      const cmd = program.commands.find((c) => c.name() === name);
      expect(
        cmd,
        `the footer names '${name}' but no such command is registered`,
      ).toBeDefined();
      // Hidden keeps the command out of commander's own Commands section,
      // so each name appears exactly once in --help. `_hidden` is private
      // commander state; there is no public accessor.
      expect(
        (cmd as unknown as { _hidden?: boolean })._hidden,
        `'${name}' is in the footer but not hidden, so it renders twice in --help`,
      ).toBe(true);
    }
  });
});
