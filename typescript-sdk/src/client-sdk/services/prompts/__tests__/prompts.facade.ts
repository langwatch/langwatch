import { describe, it, expect, beforeEach, vi } from "vitest";
import { PromptsFacade } from "../prompts.facade";
import type { InternalConfig } from "@/client-sdk/types";

// Mock the service
vi.mock("../service", () => ({
  PromptsService: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
  })),
}));

// Mock FileManager (assuming it exists)
const FileManager = {
  getLocalPromptFiles: vi.fn(),
  promptNameFromPath: vi.fn(),
  loadLocalPrompt: vi.fn(),
};

vi.mock("@/client-sdk/file-manager", () => ({
  FileManager,
}));

describe("PromptsFacade.get", () => {
  let facade: PromptsFacade;
  const mockConfig: InternalConfig = {} as InternalConfig;

  beforeEach(() => {
    facade = new PromptsFacade(mockConfig);
    vi.clearAllMocks();
  });

  describe("when checking main prompts directory", () => {
    it("should return local prompt when found", async () => {
      // Arrange
      const mockLocalPrompt = { name: "test-prompt", content: "test" };
      FileManager.getLocalPromptFiles.mockReturnValue([
        "/prompts/test-prompt.prompt.yaml"
      ]);
      FileManager.promptNameFromPath.mockReturnValue("test-prompt");
      FileManager.loadLocalPrompt.mockReturnValue(mockLocalPrompt);

      // Act
      const result = await facade.get("test-prompt");

      // Assert
      expect(result).toEqual(mockLocalPrompt);
      expect(FileManager.loadLocalPrompt).toHaveBeenCalledWith("/prompts/test-prompt.prompt.yaml");
      expect(facade.service.get).not.toHaveBeenCalled();
    });

    it("should continue to materialized when not found in main directory", async () => {
      // This test will drive us to implement materialized search
      FileManager.getLocalPromptFiles.mockReturnValue([
        "/prompts/other-prompt.prompt.yaml"
      ]);
      FileManager.promptNameFromPath.mockReturnValue("other-prompt");

      // This test will fail initially, driving materialized implementation
    });
  });

  describe("when checking materialized directory", () => {
    beforeEach(() => {
      // Setup: main directory doesn't have the prompt
      FileManager.getLocalPromptFiles.mockReturnValue([]);
    });

    it("should return materialized prompt when found", async () => {
      // This test will fail, driving us to add materialized search
      const mockMaterializedPrompt = { name: "test-prompt", content: "materialized" };

      // We'll need to mock the materialized directory search logic
      // This test drives the implementation
    });

    it("should fallback to server when not found in materialized either", async () => {
      // Arrange
      const mockServerPrompt = { id: "123", name: "test-prompt" };
      vi.mocked(facade.service.get).mockResolvedValue(mockServerPrompt);

      // Act
      const result = await facade.get("test-prompt");

      // Assert
      expect(result).toEqual(mockServerPrompt);
      expect(facade.service.get).toHaveBeenCalledWith("test-prompt", undefined);
    });
  });

  describe("error handling", () => {
    it("should fallback to server when local file system throws error", async () => {
      // Arrange
      FileManager.getLocalPromptFiles.mockImplementation(() => {
        throw new Error("File system error");
      });
      const mockServerPrompt = { id: "123", name: "test-prompt" };
      vi.mocked(facade.service.get).mockResolvedValue(mockServerPrompt);

      // Act
      const result = await facade.get("test-prompt");

      // Assert
      expect(result).toEqual(mockServerPrompt);
      expect(facade.service.get).toHaveBeenCalledWith("test-prompt", undefined);
    });
  });
});
