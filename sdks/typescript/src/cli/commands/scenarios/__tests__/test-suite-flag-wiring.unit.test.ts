/**
 * Conflicting flags (--test-suite + --no-test-suite) wired to command.
 * Spec: specs/features/scenario-cli.feature
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: "",
  }),
}));

import { buildProgram } from "../../../program";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

describe("scenario update, given both test suite flags on one line", () => {
  /** @scenario "Combining --test-suite and --no-test-suite is rejected" */
  it("refuses the command and changes nothing", async () => {
    const reported: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      reported.push(parts.join(" "));
    });
    vi.spyOn(console, "log").mockImplementation(() => {
      // intentionally empty, suppresses output during tests
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        "node",
        "langwatch",
        "scenario",
        "update",
        "scenario_abc123",
        "--test-suite",
        "suite_abc",
        "--no-test-suite",
      ]),
    ).rejects.toThrow("process.exit(1)");

    expect(exit).toHaveBeenCalledWith(1);
    expect(reported.join("\n")).toContain("cannot be used together");
  }, 30000);
});

describe("scenario create --help", () => {
  /** @scenario "The create help tells the caller to pick a test suite and never to leave it out" */
  it("says to list the test suites first, file in the one that fits or ask, and never offers omitting it", () => {
    const create = buildProgram()
      .commands.find((c) => c.name() === "scenario")
      ?.commands.find((c) => c.name() === "create");
    const flagHelp = create?.options.find((o) => o.long === "--test-suite")?.description ?? "";
    const pick =
      "Run `langwatch test-suite list` first and file the scenario in the suite that fits; " +
      "if none fits, ask the user which suite (or whether to make a new one).";

    expect(create?.description()).toContain(pick);
    expect(flagHelp).toContain(pick);
    for (const text of [create?.description() ?? "", flagHelp]) {
      expect(text).not.toMatch(/leave .*out|besides Default/i);
    }
  });
});
