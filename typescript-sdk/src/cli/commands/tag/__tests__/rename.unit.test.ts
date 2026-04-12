import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/client-sdk/services/prompts", () => ({
  PromptsApiService: vi.fn(),
  PromptsApiError: class extends Error {},
}));

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

import { tagRenameCommand } from "../rename";
import { PromptsApiService } from "@/client-sdk/services/prompts";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

describe("tagRenameCommand", () => {
  let mockRenameTag: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRenameTag = vi.fn();
    vi.mocked(PromptsApiService).mockImplementation(
      () => ({ renameTag: mockRenameTag }) as unknown as InstanceType<typeof PromptsApiService>,
    );
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("when given valid old and new names", () => {
    it("calls renameTag with old and new names", async () => {
      mockRenameTag.mockResolvedValue(undefined);

      await tagRenameCommand("canary", "beta");

      expect(mockRenameTag).toHaveBeenCalledWith({ tag: "canary", name: "beta" });
    });

    it("prints confirmation message", async () => {
      mockRenameTag.mockResolvedValue(undefined);

      await tagRenameCommand("canary", "beta");

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Renamed tag: canary -> beta"));
    });
  });

  describe("when given an invalid new name", () => {
    it("does not call renameTag", async () => {
      await expect(tagRenameCommand("canary", "INVALID!")).rejects.toThrow(ProcessExitError);

      expect(mockRenameTag).not.toHaveBeenCalled();
    });

    it("prints an error about invalid tag name format", async () => {
      await expect(tagRenameCommand("canary", "INVALID!")).rejects.toThrow(ProcessExitError);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Invalid tag name"));
    });

    it("exits with code 1", async () => {
      await expect(tagRenameCommand("canary", "INVALID!")).rejects.toMatchObject({
        code: 1,
      });
    });
  });
});
