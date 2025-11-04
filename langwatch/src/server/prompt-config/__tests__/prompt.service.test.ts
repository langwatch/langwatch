import { describe, it, expect, beforeEach, vi } from "vitest";

import { PromptService } from "~/server/prompt-config/prompt.service";

// Mock the dependencies
vi.mock("~/server/prompt-config/prompt-version.service");
vi.mock("~/server/prompt-config/repositories");

describe("PromptService", () => {
  describe("updatePrompt()", () => {
    describe("happy path", () => {
      let promptService: PromptService;
      let mockPrisma: any;
      let mockRepository: any;
      let mockVersionService: any;

      const mockConfig = {
        id: "config-1",
        name: "Test Prompt",
        handle: "test-prompt",
        scope: "PROJECT" as const,
        projectId: "project-1",
        organizationId: "org-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockLatestVersion = {
        id: "version-1",
        version: 1,
        configData: {
          prompt: "Original prompt",
          messages: [],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          model: "gpt-4",
          temperature: 0.7,
          max_tokens: 1000,
        },
        createdAt: new Date(),
      };

      const mockUpdatedVersion = {
        id: "version-2",
        version: 2,
        configData: {
          prompt: "Updated prompt",
          messages: [],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          model: "gpt-4",
          temperature: 0.8,
        },
        createdAt: new Date(),
      };

      beforeEach(() => {
        vi.clearAllMocks();

        mockPrisma = {
          $transaction: vi.fn(),
        } as any;

        mockRepository = {
          updateConfig: vi.fn(),
          versions: {
            getLatestVersion: vi.fn(),
          },
        };

        mockVersionService = {
          assertNoSystemPromptConflict: vi.fn(),
          createVersion: vi.fn(),
        };

        promptService = new PromptService(mockPrisma);
        (promptService as any).repository = mockRepository;
        (promptService as any).versionService = mockVersionService;
      });

      it("should update handle if provided", async () => {
        const updateData = {
          commitMessage: "Updated handle",
          handle: "updated-prompt",
          inputs: [{ identifier: "input", type: "str" as const }],
          outputs: [{ identifier: "output", type: "str" as const }],
        };

        mockRepository.updateConfig.mockResolvedValue(mockConfig);
        mockRepository.versions.getLatestVersion.mockResolvedValue(
          mockLatestVersion,
        );
        mockVersionService.createVersion.mockResolvedValue(mockUpdatedVersion);
        mockPrisma.$transaction.mockImplementation(async (cb: any) =>
          cb(mockPrisma),
        );

        await promptService.updatePrompt({
          idOrHandle: "test-prompt",
          projectId: "project-1",
          data: updateData,
        });

        expect(mockRepository.updateConfig).toHaveBeenCalledWith(
          "test-prompt",
          "project-1",
          { handle: "updated-prompt", scope: undefined },
          { tx: mockPrisma },
        );
      });

      it("should update scope if provided", async () => {
        const updateData = {
          commitMessage: "Updated scope",
          scope: "ORGANIZATION" as const,
          inputs: [{ identifier: "input", type: "str" as const }],
          outputs: [{ identifier: "output", type: "str" as const }],
        };

        mockRepository.updateConfig.mockResolvedValue(mockConfig);
        mockRepository.versions.getLatestVersion.mockResolvedValue(
          mockLatestVersion,
        );
        mockVersionService.createVersion.mockResolvedValue(mockUpdatedVersion);
        mockPrisma.$transaction.mockImplementation(async (cb: any) =>
          cb(mockPrisma),
        );

        await promptService.updatePrompt({
          idOrHandle: "test-prompt",
          projectId: "project-1",
          data: updateData,
        });

        expect(mockRepository.updateConfig).toHaveBeenCalledWith(
          "test-prompt",
          "project-1",
          { handle: undefined, scope: "ORGANIZATION" },
          { tx: mockPrisma },
        );
      });

      it("should create new version with provided version data", async () => {
        const projectId = "project-1";
        const configId = "config-1";
        const updateData = {
          prompt: "Updated prompt",
          model: "gpt-3.5-turbo",
          temperature: 0.8,
          messages: [],
          inputs: [
            { identifier: "name", type: "str" as const },
            { identifier: "age", type: "float" as const },
          ],
          outputs: [{ identifier: "result", type: "str" as const }],
          commitMessage: "Updated prompt configuration",
        };

        mockRepository.updateConfig.mockResolvedValue(mockConfig);
        mockRepository.versions.getLatestVersion.mockResolvedValue(
          mockLatestVersion,
        );
        mockVersionService.createVersion.mockResolvedValue(mockUpdatedVersion);
        mockPrisma.$transaction.mockImplementation(async (cb: any) =>
          cb(mockPrisma),
        );

        await promptService.updatePrompt({
          idOrHandle: configId,
          projectId,
          data: updateData,
        });

        // Extract only configData fields (exclude commitMessage, handle, scope)
        const { commitMessage, ...configDataUpdates } = updateData;

        expect(mockVersionService.createVersion).toHaveBeenCalledWith({
          db: mockPrisma,
          data: {
            configId,
            projectId,
            commitMessage,
            configData: {
              ...mockLatestVersion.configData,
              ...configDataUpdates,
            },
            schemaVersion: "1.0",
            version: 2,
          },
        });
      });
    });
  });
});
