import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PromptsConfig, PromptsLock, SyncResult } from "../../types";
import type { PromptsApiService } from "@/client-sdk/services/prompts";

// Mock FileManager before importing pull
vi.mock("../../utils/fileManager", () => ({
  FileManager: {
    saveMaterializedPrompt: vi.fn().mockReturnValue("/tmp/test.prompt.yaml"),
    updateLockEntry: vi.fn(),
    cleanupOrphanedMaterializedFiles: vi.fn().mockReturnValue([]),
    removeFromLock: vi.fn(),
  },
}));

// Mock ora spinner
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    text: "",
  }),
}));

// Mock PromptConverter
vi.mock("@/cli/utils/promptConverter", () => ({
  PromptConverter: {
    fromApiToMaterialized: vi.fn().mockReturnValue({ model: "gpt-5-mini", messages: [] }),
  },
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { pullPrompts } from "../pull";

describe("pullPrompts", () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let promptsApiService: PromptsApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    promptsApiService = {
      get: mockGet,
    } as unknown as PromptsApiService;
  });

  describe("when --tag is provided", () => {
    it("fetches each prompt using { tag } instead of version", async () => {
      mockGet.mockResolvedValue({
        version: 3,
        versionId: "cm_abc123",
        handle: "my-prompt",
      });

      const config: PromptsConfig = {
        prompts: { "my-prompt": "latest" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pullPrompts({ config, lock, promptsApiService, result, tag: "production" });

      expect(mockGet).toHaveBeenCalledWith("my-prompt", { tag: "production" });
    });

    it("overrides the version spec from prompts.json", async () => {
      mockGet.mockResolvedValue({
        version: 2,
        versionId: "cm_pinned",
        handle: "my-prompt",
      });

      const config: PromptsConfig = {
        prompts: { "my-prompt": "2" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pullPrompts({ config, lock, promptsApiService, result, tag: "staging" });

      // Should use tag: "staging", not version: "2"
      expect(mockGet).toHaveBeenCalledWith("my-prompt", { tag: "staging" });
      expect(mockGet).not.toHaveBeenCalledWith(
        "my-prompt",
        expect.objectContaining({ version: "2" }),
      );
    });

    it("records the tag as the versionSpec in the result", async () => {
      mockGet.mockResolvedValue({
        version: 3,
        versionId: "cm_abc123",
        handle: "my-prompt",
      });

      const config: PromptsConfig = {
        prompts: { "my-prompt": "latest" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pullPrompts({ config, lock, promptsApiService, result, tag: "production" });

      expect(result.fetched[0]).toMatchObject({
        name: "my-prompt",
        versionSpec: "production",
      });
    });
  });

  describe("when --tag is not provided", () => {
    it("fetches each prompt using version from config", async () => {
      mockGet.mockResolvedValue({
        version: 5,
        versionId: "cm_latest",
        handle: "my-prompt",
      });

      const config: PromptsConfig = {
        prompts: { "my-prompt": "latest" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pullPrompts({ config, lock, promptsApiService, result });

      expect(mockGet).toHaveBeenCalledWith("my-prompt", { version: "latest" });
    });
  });

  describe("when the tag is not assigned to the prompt (API error)", () => {
    it("adds the error to result.errors", async () => {
      mockGet.mockRejectedValue(new Error("tag not found"));

      const config: PromptsConfig = {
        prompts: { "my-prompt": "latest" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pullPrompts({ config, lock, promptsApiService, result, tag: "nonexistent" });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ name: "my-prompt", error: "tag not found" });
    });
  });
});
