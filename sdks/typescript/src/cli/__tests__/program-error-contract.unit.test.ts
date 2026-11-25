/**
 * Failed commands must answer in requested format (e.g., -o json). Exercise
 * the error catch with mocked throws to verify the output contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../commands/evaluators/list.js", () => ({
  listEvaluatorsCommand: () => {
    throw new Error("the implementation blew up");
  },
}));

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const AGENT_ENV = ["CLAUDECODE", "CLAUDE_CODE", "CURSOR_TRACE_ID"];

let stdout: string[] = [];
let stderr: string[] = [];
let exited: number[] = [];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(AGENT_ENV.map((n) => [n, process.env[n]]));
  for (const name of AGENT_ENV) delete process.env[name];
  stdout = [];
  stderr = [];
  exited = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    stdout.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    stderr.push(String(line));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exited.push(code ?? 0);
    return undefined as never;
  }) as never);
});

afterEach(() => {
  for (const name of AGENT_ENV) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

const runFailingCommand = async (argv: string[]): Promise<void> => {
  const { buildProgram } = await import("../program.js");
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(argv, { from: "user" });
};

describe("a command whose implementation throws", () => {
  describe("when the caller asked for JSON", () => {
    it("answers with the structured error document on stdout", async () => {
      await runFailingCommand(["evaluator", "list", "-o", "json"]);

      expect(stdout).toHaveLength(1);
      const document = JSON.parse(stdout[0]!) as {
        ok: boolean;
        error: { message: string; code: string };
      };

      expect(document.ok).toBe(false);
      expect(document.error.message).toContain("the implementation blew up");
      expect(document.error.code).toBeTruthy();
    });

    it("still fails, so the caller cannot mistake it for success", async () => {
      await runFailingCommand(["evaluator", "list", "-o", "json"]);

      expect(exited).toContain(1);
    });
  });

  // The root-position spelling is what the help text teaches, and commander
  // only puts root globals on the ROOT command — the same drop that motivated
  // the port would leave the error renderer reading `table` here.
  describe("when the format was requested before the subcommand", () => {
    it("answers with the structured error document just the same", async () => {
      await runFailingCommand(["--output", "json", "evaluator", "list"]);

      expect(stdout).toHaveLength(1);
      expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: false });
    });
  });

  describe("when no format was requested", () => {
    it("keeps stdout clean and puts the human block on stderr", async () => {
      await runFailingCommand(["evaluator", "list"]);

      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain("the implementation blew up");
      expect(exited).toContain(1);
    });
  });
});
