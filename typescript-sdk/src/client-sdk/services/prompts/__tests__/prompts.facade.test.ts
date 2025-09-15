import { describe, it, expect, beforeEach, vi } from "vitest";
import { PromptsFacade } from "../prompts.facade";
import type { InternalConfig } from "@/client-sdk/types";
import { type PromptsService } from "../service";
import { mock, type MockProxy } from "vitest-mock-extended";
import { type LocalPromptsService } from "../local-prompts.service";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import { Prompt } from "../prompt";

describe("PromptsFacade.get", () => {
  let facade: PromptsFacade;
  let localPromptsService: MockProxy<LocalPromptsService>;
  let promptsService: MockProxy<PromptsService>;
  const localHandle = "test-prompt-local";
  const serverHandle = "test-prompt-server";
  const mockLocalPrompt = promptResponseFactory.build({ handle: localHandle });
  const mockServerPrompt = promptResponseFactory.build({ handle: serverHandle });

  beforeEach(() => {
    localPromptsService = mock<LocalPromptsService>();
    promptsService = mock<PromptsService>();
    facade = new PromptsFacade({
      localPromptsService,
      promptsService,
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
      expect(result).toEqual(mockLocalPrompt);
      expect(promptsService.get).not.toHaveBeenCalled();
    });
  });

  describe("when prompt doesn't exist locally", () => {
    it("should check server", async () => {
      // Arrange
      localPromptsService.get.mockResolvedValue(null);
      promptsService.get.mockResolvedValue(new Prompt(mockServerPrompt));

      // Act
      const result = await facade.get("test-prompt");

      // Assert
      expect(result).toEqual(mockServerPrompt);
    });
  });
});
