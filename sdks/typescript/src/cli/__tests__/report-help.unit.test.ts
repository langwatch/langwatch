import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant —
// absent under vitest, so provide it before the import graph loads program.ts.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

import { buildProgram } from "../program";

/**
 * The help text IS the product for `langwatch report`: agents discover the
 * command, the consent rule, their own transcript location, and the redaction
 * guarantees from `--help` alone. These tests pin that rendered output.
 * Corresponds to specs/typescript-sdk/cli-report.feature.
 */
const renderHelp = (args: string[]): string => {
  let out = "";
  const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const program = buildProgram();
  program.exitOverride();
  for (const command of program.commands) command.exitOverride();
  try {
    program.parse(args, { from: "user" });
  } catch {
    // commander throws on --help under exitOverride; the text is captured.
  }
  writeSpy.mockRestore();
  return out;
};

describe("langwatch report help", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the root --help is rendered", () => {
    /** @scenario "Root help ends with a call to action for agents to report issues" */
    it("ends addressing AI agents with the report call to action", () => {
      const help = renderHelp(["--help"]);
      const tail = help.slice(-700);
      expect(tail).toContain("IMPORTANT, for AI agents reading this");
      expect(tail).toContain("`langwatch report`");
      expect(tail).toContain("ask your user for permission");
    });
  });

  describe("when report --help is rendered", () => {
    /** @scenario "Report help explains the two report modes" */
    it("explains the full-session and summary modes and the consent rule", () => {
      const help = renderHelp(["report", "--help"]);
      expect(help).toContain("full session transcript");
      expect(help).toContain("Send a summary instead");
      expect(help).toContain("Always ask the user before sending");
      expect(help).toContain("--user-approved");
    });

    /** @scenario "Report help tells agents where to find their own session transcript" */
    it("names the Claude Code and Codex transcript locations", () => {
      const help = renderHelp(["report", "--help"]);
      expect(help).toContain("~/.claude/projects/");
      expect(help).toContain("~/.codex/sessions/");
      expect(help).toContain(".jsonl");
    });

    /** @scenario "Report help explains redaction so agents can trust sending a full session" */
    it("lists what gets redacted and links the auditable rules", () => {
      const help = renderHelp(["report", "--help"]);
      expect(help).toContain("redacted locally");
      expect(help).toContain("provider API keys");
      expect(help).toContain("email addresses, phone numbers, credit card numbers");
      expect(help).toContain(
        "github.com/langwatch/langwatch/blob/main/packages/redaction/src/sessionReport.ts",
      );
    });
  });
});
