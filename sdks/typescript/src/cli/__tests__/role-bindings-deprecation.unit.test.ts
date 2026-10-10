/**
 * `langwatch role-bindings` is superseded by `langwatch grants`: every run of
 * the old family says so on stderr, and the new family says nothing.
 * @see specs/typescript-sdk/cli-grants.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../commands/role-bindings/list.js", () => ({
  listRoleBindingsCommand: () => {
    console.log("bindings output");
  },
}));
vi.mock("../commands/grants/list.js", () => ({
  listGrantsCommand: () => {
    console.log("grants output");
  },
}));

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

let stdout: string[] = [];
let stderr: string[] = [];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    stdout.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    stderr.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const run = async (argv: string[]): Promise<void> => {
  const { buildProgram } = await import("../program.js");
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(argv, { from: "user" });
};

describe("the role-bindings family", () => {
  describe("when one of its commands runs", () => {
    /** @scenario A role bindings command warns on stderr that grants supersede it */
    it("writes one warning to stderr naming grants, and leaves stdout to the command", async () => {
      await run(["role-bindings", "list"]);

      const warnings = stderr.filter((line) => line.includes("deprecated"));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("langwatch grants");
      expect(warnings[0]).toContain("/api/v1/grants");
      expect(stdout).toEqual(["bindings output"]);
    });
  });
});

describe("the grants family", () => {
  describe("when one of its commands runs", () => {
    /** @scenario A grants command carries no deprecation warning */
    it("writes no deprecation warning", async () => {
      await run(["grants", "list"]);

      expect(stderr.filter((line) => line.includes("deprecated"))).toEqual([]);
      expect(stdout).toEqual(["grants output"]);
    });
  });
});
