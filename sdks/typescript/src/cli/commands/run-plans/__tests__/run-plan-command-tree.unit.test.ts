/**
 * Where the run plan and test suite commands sit in the command tree, and the
 * surface header every one of their requests carries.
 *
 * Spec: specs/features/run-plan-cli.feature
 * Spec: specs/features/suite-cli.feature
 */
import { describe, expect, it, vi } from "vitest";

const useSpy = vi.hoisted(() => vi.fn());

vi.mock("@/internal/api/client", () => ({
  createLangWatchApiClient: vi.fn(() => ({ use: useSpy })),
}));

import { buildProgram } from "../../../program";
import { createCliRunPlansService } from "../cli-run-plans-service";
import { createCliTestSuitesService } from "../../test-suites/cli-test-suites-service";
import {
  CLI_SURFACE_HEADER,
  CLI_SURFACE_VALUE,
} from "../../../utils/governance/surface";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

/** The header the one registered middleware puts on a request. */
const surfaceHeaderOf = (call: unknown): string | null => {
  const middleware = call as {
    onRequest: (arg: { request: Request }) => Request;
  };
  const request = new Request("https://app.langwatch.ai/api/v1/run-plans", {
    method: "GET",
  });
  return middleware.onRequest({ request }).headers.get(CLI_SURFACE_HEADER);
};

describe("the run plan and test suite commands, given the CLI command tree", () => {
  const program = buildProgram();
  const groupNamed = (name: string) =>
    program.commands.find((command) => command.name() === name);

  /** @scenario "List run plans" */
  it("registers the run-plan group with run, list, get and archive", () => {
    const runPlan = groupNamed("run-plan");

    expect(runPlan).toBeDefined();
    expect(runPlan!.commands.map((command) => command.name())).toEqual([
      "run",
      "list",
      "get",
      "archive",
    ]);
  });

  /** @scenario "The suite group holds no folder subgroup" */
  it("registers the suite group with no folder subgroup", () => {
    const suite = groupNamed("suite");

    expect(suite).toBeDefined();
    const subcommands = suite!.commands.map((command) => command.name());
    expect(subcommands).not.toContain("folder");
    expect(subcommands).toEqual([
      "list",
      "create",
      "get",
      "rename",
      "archive",
      "run",
    ]);
  });

  /** @scenario "The suite group holds no folder subgroup" */
  it("registers no top-level folder group", () => {
    expect(program.commands.map((command) => command.name())).not.toContain(
      "folder",
    );
  });

  /** @scenario "Every run plan request declares the command line as its surface" */
  it("declares the command line as the surface on every run plan request", () => {
    useSpy.mockClear();

    createCliRunPlansService();

    expect(useSpy).toHaveBeenCalledTimes(1);
    expect(surfaceHeaderOf(useSpy.mock.calls[0]![0])).toBe(CLI_SURFACE_VALUE);
  });

  /** @scenario "Every test suite request declares the command line as its surface" */
  it("declares the command line as the surface on every test suite request", () => {
    useSpy.mockClear();

    createCliTestSuitesService();

    expect(useSpy).toHaveBeenCalledTimes(1);
    expect(surfaceHeaderOf(useSpy.mock.calls[0]![0])).toBe(CLI_SURFACE_VALUE);
  });
});
