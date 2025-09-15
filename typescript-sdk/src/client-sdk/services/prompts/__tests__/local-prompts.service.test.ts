import { describe, it, expect, beforeEach } from "vitest";
import { LocalPromptsService } from "../local-prompts.service";
import { type FileManager } from "@/cli/utils/fileManager";
import { mock, type MockProxy } from "vitest-mock-extended";
import { localPromptFactory } from "../../../../../__tests__/factories/local-prompt.factory";

describe("LocalPromptsService", () => {
  const handle = "my-handle";
  const mockPrompt = localPromptFactory.build({ handle });
  let service: LocalPromptsService;
  let mockFileManager: MockProxy<typeof FileManager>;

  beforeEach(() => {
    mockFileManager = mock<typeof FileManager>();
    const config = { fileManager: mockFileManager };
    service = new LocalPromptsService(config);
  });

  describe("get", () => {
    it("should return prompt from prompts config file mapping", async () => {
      const filePath = "custom-path/my-prompt.prompt.yaml";

      mockFileManager.loadPromptsConfig.mockReturnValue({
        prompts: {
          [handle]: { file: filePath },
        },
      });

      mockFileManager.loadLocalPrompt.mockReturnValue(mockPrompt);

      // Act
      const result = await service.get(handle);

      // Assert
      expect(result).toEqual(mockPrompt);
      expect(mockFileManager.loadLocalPrompt).toHaveBeenCalledWith(
        filePath,
      );
    });

    it("should return prompt from lock file when not in config", async () => {
      // Arrange
      mockFileManager.loadPromptsConfig.mockReturnValue({ prompts: {} });
      mockFileManager.loadPromptsLock.mockReturnValue({
        lockfileVersion: 1,
        prompts: {
          [handle]: {
            version: 1,
            versionId: "abc123",
            materialized: "prompts/.materialized/my-handle.prompt.yaml",
          },
        },
      });

      mockFileManager.loadLocalPrompt.mockReturnValue(mockPrompt);

      // Act
      const result = await service.get("my-handle");

      // Assert
      expect(result).toEqual(mockPrompt);
      expect(mockFileManager.loadLocalPrompt).toHaveBeenCalledWith(
        "prompts/.materialized/my-handle.prompt.yaml",
      );
    });

    it("should scan local files when not found in config or lock", async () => {
      // Arrange - fallback to file scanning
      mockFileManager.loadPromptsConfig.mockReturnValue({ prompts: {} });
      mockFileManager.loadPromptsLock.mockReturnValue({
        lockfileVersion: 1,
        prompts: {},
      });
      mockFileManager.getLocalPromptFiles.mockReturnValue([
        "/prompts/my-handle.prompt.yaml",
      ]);
      mockFileManager.promptNameFromPath.mockReturnValue("my-handle");
      mockFileManager.loadLocalPrompt.mockReturnValue(mockPrompt);

      // Act
      const result = await service.get("my-handle");

      // Assert
      expect(result).toEqual(mockPrompt);
    });
  });
});
