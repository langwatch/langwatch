import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.hoisted(() => vi.fn());

vi.mock("@/client-sdk/services/prompts", () => ({
  PromptsApiService: class {
    get = mockGet;
  },
}));

vi.mock("../../utils/apiKey", () => ({
  resolveCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/spinner", () => ({
  createSpinner: () => ({
    start: () => ({ succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

import { promptGetCommand } from "../prompt/get";

const PROMPT = {
  id: "prompt_abc",
  handle: "support-quality",
  version: 3,
  model: "anthropic/claude-sonnet-5",
  messages: [{ role: "system", content: "Answer briefly." }],
};

describe("given a prompt on the server", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue(PROMPT);
  });

  describe("when the reader asks for it by handle", () => {
    /** @scenario "Reading a prompt by its handle" */
    it("returns the prompt itself, not its versions", async () => {
      const result = await promptGetCommand("support-quality");

      expect(mockGet).toHaveBeenCalledWith("support-quality", {});
      expect(result?.data).toEqual(PROMPT);
    });
  });

  describe("when a version is named", () => {
    /** @scenario "Reading an older version of a prompt" */
    it("asks the server for that version", async () => {
      await promptGetCommand("support-quality", { version: "2" });

      expect(mockGet).toHaveBeenCalledWith("support-quality", {
        version: "2",
      });
    });
  });

  describe("when a tag is named", () => {
    /** @scenario "Reading the version a tag points at" */
    it("asks the server for the version the tag points at", async () => {
      await promptGetCommand("support-quality", { tag: "production" });

      expect(mockGet).toHaveBeenCalledWith("support-quality", {
        tag: "production",
      });
    });
  });
});
