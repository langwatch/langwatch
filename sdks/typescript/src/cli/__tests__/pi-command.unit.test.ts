/**
 * `langwatch pi` exists but is not advertised.
 *
 * ADR-132 lands pi capture over several steps, and the command has to be
 * runnable well before it is something to point a user at. Those are two
 * separate properties and this suite pins both: the registration actually
 * dispatches to the wrapper, and nothing in `langwatch --help` names it —
 * neither commander's own Commands section nor the hand-written "Coding
 * assistants:" footer (which help-footer.unit.test.ts pins exhaustively).
 */
import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wrapPi = vi.fn(async () => {});
vi.mock("../commands/wrap.js", () => ({
  wrapPi,
  // The other shims are unused here but the module is imported as a whole by
  // sibling actions; keeping them defined avoids an undefined-import surprise
  // if this file ever parses another command.
  wrapClaude: vi.fn(),
  wrapCodex: vi.fn(),
  wrapCopilot: vi.fn(),
  wrapCode: vi.fn(),
  wrapCursor: vi.fn(),
  wrapGemini: vi.fn(),
  wrapOpencode: vi.fn(),
}));

import { buildProgram } from "../program";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant,
// which no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

function helpOutput(program: Command): string {
  let out = "";
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
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

/**
 * Every name `langwatch --help` puts in front of a reader: the first word of
 * each indented entry line, across commander's own sections and the
 * hand-written footer alike.
 */
function advertisedNames(help: string): string[] {
  return help
    .split("\n")
    .map((line) => /^\s{2,}(\S+)/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

describe("the pi command", () => {
  beforeEach(() => {
    wrapPi.mockClear();
  });

  /** @scenario "The pi command runs but is not advertised yet" */
  it("runs pi through the wrapper without appearing in the advertised commands", async () => {
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync(["pi", "--model", "anthropic/some-model"], {
      from: "user",
    });

    expect(
      wrapPi,
      "`langwatch pi` did not reach the wrapper, so the command does not run",
    ).toHaveBeenCalledWith(["--model", "anthropic/some-model"]);

    const names = advertisedNames(helpOutput(buildProgram()));
    // Canary: a broken extractor would return nothing and make the assertion
    // below pass while checking nothing.
    expect(names, "no command names were extracted from --help").toContain(
      "trace",
    );
    expect(
      names,
      "pi is advertised in --help; it must stay hidden until capture is finished",
    ).not.toContain("pi");
  });

  it("is registered hidden", () => {
    const program = buildProgram();
    const pi = program.commands.find((c) => c.name() === "pi");

    expect(pi, "no `pi` command is registered").toBeDefined();
    // `_hidden` is private commander state; there is no public accessor.
    expect((pi as unknown as { _hidden?: boolean })._hidden).toBe(true);
  });
});
