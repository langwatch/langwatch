import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/client-sdk/services/prompts", () => ({
  PromptsApiService: vi.fn(),
  PromptsApiError: class extends Error {},
}));

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

import { tagAssignCommand } from "../assign";
import { PromptsApiService } from "@/client-sdk/services/prompts";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

describe("tagAssignCommand", () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let mockAssignTag: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    mockAssignTag = vi.fn();
    vi.mocked(PromptsApiService).mockImplementation(
      () =>
        ({
          get: mockGet,
          assignTag: mockAssignTag,
        }) as unknown as InstanceType<typeof PromptsApiService>,
    );
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("when assigning to latest version (no --version given)", () => {
    it("fetches the prompt without version", async () => {
      mockGet.mockResolvedValue({ version: 5, versionId: "cm_abc123" });
      mockAssignTag.mockResolvedValue({});

      await tagAssignCommand("my-prompt", "production");

      expect(mockGet).toHaveBeenCalledWith("my-prompt", {});
    });

    it("calls assignTag with the resolved versionId", async () => {
      mockGet.mockResolvedValue({ version: 5, versionId: "cm_abc123" });
      mockAssignTag.mockResolvedValue({});

      await tagAssignCommand("my-prompt", "production");

      expect(mockAssignTag).toHaveBeenCalledWith({
        id: "my-prompt",
        tag: "production",
        versionId: "cm_abc123",
      });
    });

    it("prints confirmation of the assignment", async () => {
      mockGet.mockResolvedValue({ version: 5, versionId: "cm_abc123" });
      mockAssignTag.mockResolvedValue({});

      await tagAssignCommand("my-prompt", "production");

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Assigned tag 'production' to my-prompt"),
      );
    });
  });

  describe("when assigning to a specific version", () => {
    it("fetches the prompt with the version option", async () => {
      mockGet.mockResolvedValue({ version: 3, versionId: "cm_def456" });
      mockAssignTag.mockResolvedValue({});

      await tagAssignCommand("my-prompt", "production", { version: "3" });

      expect(mockGet).toHaveBeenCalledWith("my-prompt", { version: "3" });
    });

    it("calls assignTag with the resolved versionId", async () => {
      mockGet.mockResolvedValue({ version: 3, versionId: "cm_def456" });
      mockAssignTag.mockResolvedValue({});

      await tagAssignCommand("my-prompt", "production", { version: "3" });

      expect(mockAssignTag).toHaveBeenCalledWith({
        id: "my-prompt",
        tag: "production",
        versionId: "cm_def456",
      });
    });
  });

  describe("when the prompt does not exist", () => {
    it("prints an error message", async () => {
      mockGet.mockRejectedValue(new Error("Prompt not found"));

      await expect(tagAssignCommand("nonexistent", "production")).rejects.toThrow();

      // The error propagates, command doesn't silently pass
    });
  });

  describe("when --version is not a positive integer", () => {
    it("exits with code 1 without calling the API", async () => {
      await expect(
        tagAssignCommand("my-prompt", "production", { version: "not-a-number" }),
      ).rejects.toMatchObject({ code: 1 });

      expect(mockGet).not.toHaveBeenCalled();
      expect(mockAssignTag).not.toHaveBeenCalled();
    });

    it("prints an error about invalid version", async () => {
      await expect(
        tagAssignCommand("my-prompt", "production", { version: "abc" }),
      ).rejects.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("--version must be a positive integer"),
      );
    });
  });
});
