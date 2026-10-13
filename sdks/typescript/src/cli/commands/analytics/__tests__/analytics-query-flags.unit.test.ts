/**
 * The `--include-langy` flag reaches the query only through program.ts, which
 * maps commander's `includeLangy` onto `shouldIncludeLangy`. This parses the
 * command the way a caller spells it, so a broken mapping fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryAnalyticsCommand = vi.fn();

vi.mock("../query.js", () => ({
  queryAnalyticsCommand: (options: unknown) => queryAnalyticsCommand(options),
}));

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const runAnalyticsQuery = async (args: string[]): Promise<void> => {
  const { buildProgram } = await import("../../../program.js");
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["analytics", "query", ...args], { from: "user" });
};

beforeEach(() => {
  queryAnalyticsCommand.mockReset();
  queryAnalyticsCommand.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("langwatch analytics query", () => {
  describe("when --include-langy is given", () => {
    /** @scenario "Langy's own turns are counted when asked" */
    it("asks the query to include Langy's own turns", async () => {
      await runAnalyticsQuery(["--include-langy"]);

      expect(queryAnalyticsCommand).toHaveBeenCalledWith(
        expect.objectContaining({ shouldIncludeLangy: true }),
      );
    });
  });

  describe("when --include-langy is not given", () => {
    /** @scenario "Langy's own turns are left out of the numbers" */
    it("leaves the query on its default", async () => {
      await runAnalyticsQuery(["--group-by", "metadata.model"]);

      const options = queryAnalyticsCommand.mock.calls[0]![0] as Record<string, unknown>;
      expect(options.shouldIncludeLangy).toBeUndefined();
      expect(options.groupBy).toBe("metadata.model");
    });
  });
});
