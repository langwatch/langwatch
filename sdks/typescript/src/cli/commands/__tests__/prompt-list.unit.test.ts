/**
 * `prompt list` under `--limit`, the paging flag every other list command takes.
 *
 * Without it the command answered "unknown option '--limit'", which is where a
 * caller that has used `experiment list` starts, and what sent one agent off to
 * write its own reader instead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAll = vi.hoisted(() => vi.fn());

vi.mock("@/client-sdk/services/prompts", () => ({
  PromptsApiService: class {
    getAll = mockGetAll;
  },
  PromptsError: class extends Error {},
}));

vi.mock("../../utils/apiKey", () => ({
  resolveCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/spinner", () => ({
  createSpinner: () => ({
    start: () => ({ succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

import { listCommand } from "../list";

const PROMPTS = Array.from({ length: 44 }, (_, index) => ({
  id: `prompt_${index}`,
  handle: `support-quality-${index}`,
  version: 1,
  model: "openai/gpt-5-mini",
  updatedAt: "2026-08-25T10:00:00.000Z",
}));

const tableOutput = async (options?: { limit?: string }): Promise<string> => {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  try {
    const result = await listCommand(options);
    result?.table?.();
    return lines.join("\n");
  } finally {
    log.mockRestore();
  }
};

describe("given a project with 44 prompts", () => {
  beforeEach(() => {
    mockGetAll.mockReset();
    mockGetAll.mockResolvedValue(PROMPTS);
  });

  describe("when the caller asks for the first few", () => {
    /** @scenario "The prompts list is cut to the first rows" */
    it("returns that many prompts", async () => {
      const result = await listCommand({ limit: "5" });

      expect(result?.data).toHaveLength(5);
      expect(result?.data).toEqual(PROMPTS.slice(0, 5));
    });

    /** @scenario "A cut prompts list says how many prompts exist" */
    it("says how many prompts exist behind the cut", async () => {
      expect(await tableOutput({ limit: "5" })).toContain("Showing 5 of 44");
    });
  });

  describe("when the limit is above the number of prompts", () => {
    /** @scenario "A limit above the number of prompts changes nothing" */
    it("returns every prompt and states no partial count", async () => {
      const result = await listCommand({ limit: "100" });

      expect(result?.data).toHaveLength(44);
      expect(await tableOutput({ limit: "100" })).not.toContain("Showing");
    });
  });

  describe("when no limit is given", () => {
    it("returns every prompt", async () => {
      const result = await listCommand();

      expect(result?.data).toHaveLength(44);
    });
  });

  describe("when the limit is not a positive number", () => {
    /**
     * Ending the command is what `experiment versions` does with the same flag.
     * Dropping the value instead lists the whole server, and the caller reads
     * that as the page they asked for.
     */
    it.each([["nonsense"], ["0"], ["-1"], ["1.5"]])(
      "refuses %s rather than listing everything",
      async (limit) => {
        const exit = vi
          .spyOn(process, "exit")
          .mockImplementation((code?: string | number | null | undefined) => {
            throw new Error(`process.exit(${String(code)})`);
          });
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(listCommand({ limit })).rejects.toThrow("process.exit(1)");
        expect(error.mock.calls[0]?.[0]).toContain("--limit takes");

        exit.mockRestore();
        error.mockRestore();
      },
    );
  });
});
