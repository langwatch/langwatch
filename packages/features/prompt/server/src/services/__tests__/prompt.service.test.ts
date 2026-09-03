import { beforeEach, describe, expect, it, vi } from "vitest";

import { PromptService } from "../prompt.service";
import { createPromptServiceForTest } from "../../repositories/prisma/__tests__/prompt-service.test-fixture";

describe("PromptService", () => {
  describe("updatePrompt()", () => {
    describe("happy path", () => {
      let promptService: PromptService;
      const updateConfigAndCreateVersion = vi.fn();

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
        schemaVersion: "1.0",
        projectId: "project-1",
        configId: "config-1",
        authorId: null,
        commitMessage: "Initial",
        runtimeParameters: {},
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
        schemaVersion: "1.0",
        projectId: "project-1",
        configId: "config-1",
        authorId: null,
        commitMessage: "Update",
        runtimeParameters: {},
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
        promptService = createPromptServiceForTest();
        vi.spyOn(promptService.repository, "updateConfigAndCreateVersion").mockImplementation(
          updateConfigAndCreateVersion,
        );
      });

      it("updates handle if provided", async () => {
        const updateData = {
          commitMessage: "Updated handle",
          handle: "updated-prompt",
          inputs: [{ identifier: "input", type: "str" as const }],
          outputs: [{ identifier: "output", type: "str" as const }],
        };

        updateConfigAndCreateVersion.mockResolvedValue({
          ...mockConfig,
          latestVersion: mockUpdatedVersion,
        });

        await promptService.updatePrompt({
          idOrHandle: "test-prompt",
          projectId: "project-1",
          data: updateData,
        });

        expect(updateConfigAndCreateVersion).toHaveBeenCalledWith(
          expect.objectContaining({
            idOrHandle: "test-prompt",
            projectId: "project-1",
            data: { handle: "updated-prompt", scope: undefined },
          }),
        );
      });

      it("updates scope if provided", async () => {
        const updateData = {
          commitMessage: "Updated scope",
          scope: "ORGANIZATION" as const,
          inputs: [{ identifier: "input", type: "str" as const }],
          outputs: [{ identifier: "output", type: "str" as const }],
        };

        updateConfigAndCreateVersion.mockResolvedValue({
          ...mockConfig,
          latestVersion: mockUpdatedVersion,
        });

        await promptService.updatePrompt({
          idOrHandle: "test-prompt",
          projectId: "project-1",
          data: updateData,
        });

        expect(updateConfigAndCreateVersion).toHaveBeenCalledWith(
          expect.objectContaining({
            idOrHandle: "test-prompt",
            projectId: "project-1",
            data: { handle: undefined, scope: "ORGANIZATION" },
          }),
        );
      });

      it("creates new version with provided version data", async () => {
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

        updateConfigAndCreateVersion.mockResolvedValue({
          ...mockConfig,
          latestVersion: mockUpdatedVersion,
        });

        await promptService.updatePrompt({
          idOrHandle: configId,
          projectId,
          data: updateData,
        });

        // Extract only configData fields (exclude commitMessage, handle, scope).
        const { commitMessage, ...configDataUpdates } = updateData;

        expect(updateConfigAndCreateVersion).toHaveBeenCalledWith(
          expect.objectContaining({
            idOrHandle: configId,
            projectId,
            commitMessage,
            configDataUpdates,
          }),
        );
      });
    });
  });
});
