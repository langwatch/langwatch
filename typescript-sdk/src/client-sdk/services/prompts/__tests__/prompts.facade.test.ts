import { describe, it, expect, beforeEach, vi } from "vitest";
import { PromptsFacade } from "../prompts.facade";
import type { InternalConfig } from "@/client-sdk/types";
import { type PromptsService } from "../service";
import { mock, type MockProxy } from "vitest-mock-extended";
import { type LocalPromptsService } from "./local-prompts.service";

describe("PromptsFacade.get", () => {
  let facade: PromptsFacade;
  let localPromptsService: MockProxy<LocalPromptsService>;
  let promptsService: MockProxy<PromptsService>;

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
      const mockLocalPrompt = { name: "test-prompt", content: "test" };
      localPromptsService.get.mockResolvedValue(mockLocalPrompt);

      // Act
      const result = await facade.get("test-prompt");

      // Assert
      expect(result).toEqual(mockLocalPrompt);
      expect(promptsService.get).not.toHaveBeenCalled();
    });
  });

  describe("when prompt doesn't exist locally", () => {
    it("should check server", async () => {
      // Arrange
      localPromptsService.get.mockResolvedValue(null);
      const mockServerPrompt = { id: "123", name: "test-prompt" };
      promptsService.get.mockResolvedValue(mockServerPrompt);

      // Act
      const result = await facade.get("test-prompt");

      // Assert
      expect(result).toEqual(mockServerPrompt);
    });
  });
});
