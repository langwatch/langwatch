import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildProgram } from "../program";
import { renderAgentHelpTopic } from "../commands/help";
import { AGENT_MODE_ENV_VARS } from "../utils/output";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant —
// stub it for the in-process test run (no bundler define under vitest).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

describe("renderAgentHelpTopic", () => {
  it("covers the agent contract end to end", () => {
    const page = renderAgentHelpTopic();

    // Agent mode + every auto-detect env var (rendered from the constant, so
    // this fails if a var is dropped from one place but not the other).
    expect(page).toContain("--agent");
    for (const name of AGENT_MODE_ENV_VARS) {
      expect(page).toContain(name);
    }
    // Output contract.
    expect(page).toContain("-o, --output");
    expect(page).toContain("--json <fields>");
    expect(page).toContain("--jq <expr>");
    // Structured errors.
    expect(page).toContain('"ok": false');
    expect(page).toContain("suggestions");
    // Discovery.
    expect(page).toContain("langwatch commands");
    expect(page).toContain("langwatch help-tree");
    expect(page).toContain("langwatch docs");
    expect(page).toContain("langwatch scenario-docs");
    // Skills.
    expect(page).toContain("langwatch skills install");
    expect(page).toContain("~/.agents/skills");
    // Daemon + piping.
    expect(page).toContain("LANGWATCH_NO_DAEMON");
    expect(page).toContain("2>&1");
  });

  it("stays short enough to inject into a context window", () => {
    // The page is agent context: keep it near a screenful, not an essay.
    expect(renderAgentHelpTopic().split("\n").length).toBeLessThanOrEqual(70);
  });
});

describe("`langwatch help` command", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    // commander's outputHelp writes straight to process.stdout (each command
    // carries its own output configuration, so configureOutput on the root
    // would not capture `help <subcommand>`).
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  const stdoutText = (): string =>
    stdoutSpy.mock.calls
      .flat()
      .map((chunk: unknown) => String(chunk))
      .join("");

  it("`help agent` prints the agent topic page", async () => {
    await buildProgram().parseAsync(["node", "langwatch", "help", "agent"]);

    const out = consoleLogSpy.mock.calls.flat().join("\n");
    expect(out).toContain("AGENT MODE");
    expect(out).toContain("OUTPUT CONTRACT");
    expect(out).toContain("PIPING RULES");
    expect(process.exitCode).toBe(0);
  });

  it("`help <command>` still prints that command's help", async () => {
    await buildProgram().parseAsync(["node", "langwatch", "help", "trace"]);

    expect(stdoutText()).toContain("Search and inspect traces");
    expect(process.exitCode).toBe(0);
  });

  it("`help` alone prints the root help, listing the help command itself", async () => {
    await buildProgram().parseAsync(["node", "langwatch", "help"]);

    const out = stdoutText();
    expect(out).toContain("LangWatch CLI");
    expect(out).toContain("help [options] [topic...]");
    expect(process.exitCode).toBe(0);
  });

  it("`help <command> <subcommand>` prints the nested command's help", async () => {
    await buildProgram().parseAsync([
      "node",
      "langwatch",
      "help",
      "trace",
      "search",
    ]);

    expect(stdoutText()).toContain("Usage: langwatch trace search");
    expect(process.exitCode).toBe(0);
  });

  it("`help <unknown>` errors with a non-zero exit code", async () => {
    await buildProgram().parseAsync([
      "node",
      "langwatch",
      "help",
      "nosuchtopic",
    ]);

    const err = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(err).toContain("unknown command or help topic 'nosuchtopic'");
    expect(process.exitCode).toBe(1);
  });
});
