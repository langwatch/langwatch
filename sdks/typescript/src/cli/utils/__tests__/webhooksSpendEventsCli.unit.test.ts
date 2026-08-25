import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstantOrNull } from "../instant";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant,
// absent under vitest; provide it before the dynamic import below.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const commandPaths = async (family: string): Promise<string[]> => {
  const { buildProgram } = await import("../../program.js");
  const program = buildProgram();
  const familyCmd = program.commands.find((c) => c.name() === family);
  if (!familyCmd) return [];
  return familyCmd.commands.map((c) => c.name());
};

describe("Feature: CLI families for webhooks and spend events", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** @scenario The webhooks family lists every endpoint lifecycle command */
  it("registers the full webhooks lifecycle", async () => {
    expect((await commandPaths("webhooks")).sort()).toEqual(
      [
        "list",
        "get",
        "create",
        "update",
        "enable",
        "disable",
        "archive",
        "roll-secret",
        "test",
        "deliveries",
        "health",
        "event-types",
        "events",
      ].sort(),
    );
  });

  /** @scenario The spend-events family covers pull and rollup */
  it("registers spend-events list and by-user", async () => {
    expect((await commandPaths("spend-events")).sort()).toEqual([
      "by-user",
      "list",
      "replay",
      "summary",
    ]);
  });

  /** @scenario Org-anchored commands resolve the organization API key */
  it("uses LANGWATCH_API_KEY, the one supported credential, and exits without it", async () => {
    const { checkOrgApiKey } = await import("../apiKey.js");

    vi.stubEnv("LANGWATCH_API_KEY", "sk-lw-key");
    expect(checkOrgApiKey()).toBe("sk-lw-key");

    vi.stubEnv("LANGWATCH_API_KEY", "");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => checkOrgApiKey()).toThrow("exit");
    expect(
      stderr.mock.calls.flat().some((line) => String(line).includes("LANGWATCH_API_KEY")),
    ).toBe(true);
    exit.mockRestore();
    stderr.mockRestore();
  });

  /** @scenario From and to flags parse ISO-8601 and epoch milliseconds */
  it("parses ISO instants and epoch ms, refusing garbage", () => {
    expect(parseInstantOrNull("2026-07-01T00:00:00Z")).toBe(
      Date.parse("2026-07-01T00:00:00Z"),
    );
    expect(parseInstantOrNull("1753791000000")).toBe(1753791000000);
    expect(parseInstantOrNull("not-a-date")).toBeNull();
    expect(parseInstantOrNull("-5")).toBeNull();
    expect(parseInstantOrNull("")).toBeNull();
  });
});
