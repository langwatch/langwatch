import { describe, it, expect, beforeEach } from "vitest";
import { LocalPromptsService } from "../local-prompts.service";
import { type FileManager } from "@/cli/utils/fileManager";
import { mock, type MockProxy } from "vitest-mock-extended";
import { localPromptConfigFactory } from "../../../../../__tests__/factories/local-prompt-config.factory";
import { type Logger } from "@/logger";
import { type LocalPromptConfig } from "@/cli/types";

describe("LocalPromptsService", () => {
  const handle = "my-handle";
  const mockPrompt = localPromptConfigFactory.build({ handle });
  let service: LocalPromptsService;
  let mockFileManager: MockProxy<typeof FileManager>;
  let mockLogger: MockProxy<Logger>;

  beforeEach(() => {
    mockFileManager = mock<typeof FileManager>();
    mockLogger = mock<Logger>();
    const config = {
      fileManager: mockFileManager,
      logger: mockLogger,
    };
    service = new LocalPromptsService(config);
  });

  describe("get", () => {
    describe("when prompt has direct file path in config", () => {
      it("should return prompt from the file", async () => {
        const filePath = "custom-path/my-prompt.prompt.yaml";

        mockFileManager.loadPromptsConfig.mockReturnValue({
          prompts: {
            [handle]: `file:${filePath}`,
          },
        });

        mockFileManager.loadLocalPrompt.mockReturnValue(mockPrompt);

        const result = await service.get(handle);

        expect(result).toEqual(expect.objectContaining({
          model: mockPrompt.model,
          messages: mockPrompt.messages,
          temperature: mockPrompt.modelParameters?.temperature,
          maxTokens: mockPrompt.modelParameters?.max_tokens,
          handle: handle,
        }));

        expect(mockFileManager.loadLocalPrompt).toHaveBeenCalledWith(filePath);
      });
    });

    describe("when config has version reference", () => {
      it("should return prompt from lock file materialized path", async () => {
        mockFileManager.loadPromptsConfig.mockReturnValue({
          prompts: {
            [handle]: "1.2.3",
          },
        });
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

        const result = await service.get(handle);

        expect(result).toEqual(expect.objectContaining({
          model: mockPrompt.model,
          messages: mockPrompt.messages,
          temperature: mockPrompt.modelParameters?.temperature,
          maxTokens: mockPrompt.modelParameters?.max_tokens,
          handle: handle,
        }));

        expect(mockFileManager.loadLocalPrompt).toHaveBeenCalledWith(
          "prompts/.materialized/my-handle.prompt.yaml",
        );
      });
    });

    describe("when config has 'latest' reference", () => {
      it("should return prompt from lock file materialized path", async () => {
        mockFileManager.loadPromptsConfig.mockReturnValue({
          prompts: {
            [handle]: "latest",
          },
        });
        mockFileManager.loadPromptsLock.mockReturnValue({
          lockfileVersion: 1,
          prompts: {
            [handle]: {
              version: 2,
              versionId: "def456",
              materialized: "prompts/.materialized/my-handle.prompt.yaml",
            },
          },
        });

        mockFileManager.loadLocalPrompt.mockReturnValue(mockPrompt);

        const result = await service.get(handle);

        expect(result).toEqual(expect.objectContaining({
          model: mockPrompt.model,
          messages: mockPrompt.messages,
          temperature: mockPrompt.modelParameters?.temperature,
          maxTokens: mockPrompt.modelParameters?.max_tokens,
          handle: handle,
        }));

        expect(mockFileManager.loadLocalPrompt).toHaveBeenCalledWith(
          "prompts/.materialized/my-handle.prompt.yaml",
        );
      });
    });

    describe("when prompt is not referenced in config", () => {
      it("should return null", async () => {
        mockFileManager.loadPromptsConfig.mockReturnValue({ prompts: {} });

        const result = await service.get(handle);

        expect(result).toBeNull();
        expect(mockFileManager.loadPromptsLock).not.toHaveBeenCalled();
        expect(mockFileManager.getLocalPromptFiles).not.toHaveBeenCalled();
      });
    });

    describe("when explicitly referenced file fails to load", () => {
      const filePath = "missing-file.prompt.yaml";
      const errorMessage =
        "Local prompt file not found: missing-file.prompt.yaml";
      let result: LocalPromptConfig | null;

      beforeEach(async () => {
        mockFileManager.loadPromptsConfig.mockReturnValue({
          prompts: {
            [handle]: `file:${filePath}`,
          },
        });

        mockFileManager.loadLocalPrompt.mockImplementation(() => {
          throw new Error(errorMessage);
        });
        result = await service.get(handle);
      });

      it("should log warning", async () => {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          `Failed to get prompt "${handle}": ${errorMessage}`,
        );
      });

      it("should return null", async () => {
        expect(result).toBeNull();
      });
    });

    describe("when version reference fails to materialize", () => {
      const errorMessage =
        "Local prompt file not found: prompts/.materialized/my-handle.prompt.yaml";
      let result: LocalPromptConfig | null;

      beforeEach(async () => {
        mockFileManager.loadPromptsConfig.mockReturnValue({
          prompts: {
            [handle]: "1.2.3",
          },
        });
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
        mockFileManager.loadLocalPrompt.mockImplementation(() => {
          throw new Error(errorMessage);
        });
        result = await service.get(handle);
      });

      it("should log warning", async () => {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          `Failed to get prompt "${handle}": ${errorMessage}`,
        );
      });

      it("should return null", async () => {
        expect(result).toBeNull();
      });
    });
  });
});
