import { describe, it, expect, beforeEach, vi } from "vitest";
import { PromptsFacade } from "../prompts.facade";
import type { InternalConfig } from "@/client-sdk/types";
import { type PromptsApiService } from "../prompts-api.service";
import { mock, type MockProxy } from "vitest-mock-extended";
import { type LocalPromptsService } from "../local-prompts.service";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import { Prompt } from "../prompt";
import { localPromptConfigFactory } from "../../../../../__tests__/factories/local-prompt-config.factory";

describe("PromptsFacade.get", () => {
  const localHandle = "test-prompt-local";
  const serverHandle = "test-prompt-server";
  const mockLocalPrompt = localPromptConfigFactory.build({ handle: localHandle });
  const mockServerPrompt = promptResponseFactory.build({ handle: serverHandle });

  let facade: PromptsFacade;
  let localPromptsService: MockProxy<LocalPromptsService>;
  let promptsApiService: MockProxy<PromptsApiService>;

  beforeEach(() => {
    localPromptsService = mock<LocalPromptsService>();
    promptsApiService = mock<PromptsApiService>();
    facade = new PromptsFacade({
      localPromptsService,
      promptsApiService,
      langwatchApiClient: {} as InternalConfig["langwatchApiClient"],
      logger: {} as InternalConfig["logger"],
    });
    vi.clearAllMocks();
  });

  describe("when prompt exists locally", () => {
    it("should return local prompt without checking server", async () => {
      // Arrange
      localPromptsService.get.mockResolvedValue(mockLocalPrompt);

      // Act
      const result = await facade.get(localHandle);

      // Assert
      expect(result).toEqual(new Prompt(mockLocalPrompt));
      expect(promptsApiService.get).not.toHaveBeenCalled();
    });
  });

  describe("when prompt doesn't exist locally", () => {
    it("should check server", async () => {
      // Arrange
      localPromptsService.get.mockResolvedValue(null);
      promptsApiService.get.mockResolvedValue(mockServerPrompt);

      // Act
      const result = await facade.get(serverHandle);

      // Assert
      expect(result).toEqual(new Prompt(mockServerPrompt));
    });
  });
});
