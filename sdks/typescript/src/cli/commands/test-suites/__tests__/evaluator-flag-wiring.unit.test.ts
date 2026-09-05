/**
 * `--required` and `--not-required` apply to the `--evaluator` written just
 * before them. A boolean flag keeps only its last value in commander, so
 * program.ts records the three flags in the order they are read and hands the
 * command an ordered list.
 *
 * This drives the real program rather than the command function: the pairing
 * is only worth anything if the wiring hands it over, and a test of the
 * function alone cannot see that.
 *
 * Spec: specs/features/test-suite-cli.feature
 */
import { describe, expect, it, vi } from "vitest";

const createSpy = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../create", () => ({
  createTestSuiteCommand: createSpy,
}));

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

const silence = () => {
  const reported: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    reported.push(parts.join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => {
    // intentionally empty, suppresses output during tests
  });
  return reported;
};

describe("test-suite create, given the evaluator gate flags", () => {
  /** @scenario "The gate flag applies to the evaluator written just before it" */
  it("hands the command the evaluators in order, each with its own gate", async () => {
    silence();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "langwatch",
      "test-suite",
      "create",
      "Case lookups",
      "--evaluator",
      "judge",
      "--not-required",
      "--evaluator",
      "scanner",
      "--evaluator",
      "sql",
      "--required",
    ]);

    expect(createSpy).toHaveBeenCalledWith(
      "Case lookups",
      expect.objectContaining({
        evaluators: [
          { reference: "judge", required: false },
          { reference: "scanner" },
          { reference: "sql", required: true },
        ],
      }),
    );
  }, 30000);

  /** @scenario "A gate flag written before any evaluator is refused" */
  it("refuses a gate flag written before any evaluator", async () => {
    const reported = silence();
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        "node",
        "langwatch",
        "test-suite",
        "create",
        "Case lookups",
        "--required",
        "--evaluator",
        "judge",
      ]),
    ).rejects.toThrow();

    expect(exit).toHaveBeenCalledWith(1);
    expect(reported.join("\n")).toContain("must follow the --evaluator");
  }, 30000);
});
