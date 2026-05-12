import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/client-sdk/services/prompts", () => ({
  PromptsApiService: vi.fn(),
  PromptsApiError: class extends Error {},
}));

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

import { tagCreateCommand } from "../create";
import { PromptsApiService } from "@/client-sdk/services/prompts";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

describe("tagCreateCommand", () => {
  let mockCreateTag: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTag = vi.fn();
    vi.mocked(PromptsApiService).mockImplementation(
      () => ({ createTag: mockCreateTag }) as unknown as InstanceType<typeof PromptsApiService>,
    );
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("when given a valid tag name", () => {
    it("calls createTag with the name", async () => {
      mockCreateTag.mockResolvedValue({ name: "canary", createdAt: new Date().toISOString() });

      await tagCreateCommand("canary");

      expect(mockCreateTag).toHaveBeenCalledWith({ name: "canary" });
    });

    it("prints confirmation message", async () => {
      mockCreateTag.mockResolvedValue({ name: "canary", createdAt: new Date().toISOString() });

      await tagCreateCommand("canary");

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Created tag: canary"));
    });
  });

  describe("when given an invalid tag name", () => {
    it("does not call createTag", async () => {
      await expect(tagCreateCommand("INVALID_NAME!")).rejects.toThrow(ProcessExitError);

      expect(mockCreateTag).not.toHaveBeenCalled();
    });

    it("prints an error about invalid tag name format", async () => {
      await expect(tagCreateCommand("INVALID_NAME!")).rejects.toThrow(ProcessExitError);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Invalid tag name"));
    });

    it("exits with code 1", async () => {
      await expect(tagCreateCommand("INVALID_NAME!")).rejects.toMatchObject({
        code: 1,
      });
    });
  });

  describe("when the API returns a duplicate error", () => {
    it("propagates the error", async () => {
      mockCreateTag.mockRejectedValue(new Error("Tag already exists"));

      await expect(tagCreateCommand("canary")).rejects.toThrow("Tag already exists");
    });
  });
});
