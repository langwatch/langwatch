/**
 * The short `-f` spelling reaches the query only through program.ts. This
 * parses the command the way a caller spells it, so a missing alias fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runQueryCommand = vi.fn();

vi.mock("../run.js", () => ({
  runQueryCommand: (sql: unknown, options: unknown) => runQueryCommand(sql, options),
}));

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const runQuery = async (args: string[]): Promise<void> => {
  const { buildProgram } = await import("../../../program.js");
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["query", ...args], { from: "user" });
};

beforeEach(() => {
  runQueryCommand.mockReset();
  runQueryCommand.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("langwatch query", () => {
  describe("when the format is given as -f", () => {
    /** @scenario "The format flag has the same short spelling as every other command" */
    it("passes the format through like --format", async () => {
      await runQuery(["SELECT count() AS n FROM traces", "-f", "json"]);

      const options = runQueryCommand.mock.calls[0]![1] as Record<string, unknown>;
      expect(options.format).toBe("json");
    });
  });
});
