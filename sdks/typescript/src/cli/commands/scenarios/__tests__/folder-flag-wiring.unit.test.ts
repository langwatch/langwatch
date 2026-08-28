/**
 * `--folder <folder>` and `--no-folder` share ONE commander attribute, so
 * whichever flag comes last on the line silently wins and a caller who passed
 * both is never told. program.ts records each flag as commander reads it, so
 * the command can refuse the pair.
 *
 * This drives the real program rather than the command function: the refusal
 * is only worth anything if the wiring hands both flags over, and a test of
 * the function alone cannot see that.
 *
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

describe("scenario update, given both folder flags on one line", () => {
  /** @scenario "Combining --folder and --no-folder is rejected" */
  it("refuses the command and changes nothing", async () => {
    const reported: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      reported.push(parts.join(" "));
    });
    vi.spyOn(console, "log").mockImplementation(() => {
      // intentionally empty, suppresses output during tests
    });
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
        "scenario",
        "update",
        "scenario_abc123",
        "--folder",
        "folder_abc",
        "--no-folder",
      ]),
    ).rejects.toThrow();

    expect(exit).toHaveBeenCalledWith(1);
    expect(reported.join("\n")).toContain("cannot be used together");
  }, 30000);
});
