/**
 * `langwatch agent list --wait-online ACME checkout` is a name with a space
 * passed bare. Commander refuses the stray word; the refusal has to say why,
 * or the caller reads it as the wait being broken.
 *
 * @see specs/typescript-sdk/cli-agents.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTED_NAME_HINT, withQuotedNameHint } from "../quoted-name-hint";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

describe("withQuotedNameHint()", () => {
  /** @scenario "A name with spaces passed bare is told to quote it" */
  it("adds the quoting hint under commander's too-many-arguments line", () => {
    const line =
      "error: too many arguments for 'list'. Expected 0 arguments but got 1: checkout.\n";
    expect(withQuotedNameHint(line)).toBe(
      `${line.trimEnd()}\n${QUOTED_NAME_HINT}\n`,
    );
  });

  it("leaves every other error line alone", () => {
    const line = "error: unknown option '--wait'\n";
    expect(withQuotedNameHint(line)).toBe(line);
  });
});

describe("langwatch agent list --wait-online ACME checkout", () => {
  let stderr: string[] = [];

  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "A name with spaces passed bare is told to quote it" */
  it("refuses the stray word and says the name goes in quotes", async () => {
    const { buildProgram } = await import("../../../program.js");
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(
        ["agent", "list", "--wait-online", "ACME", "checkout", "--format", "json"],
        { from: "user" },
      ),
    ).rejects.toThrow();

    const text = stderr.join("");
    expect(text).toContain("too many arguments");
    expect(text).toContain(QUOTED_NAME_HINT);
  });
});
