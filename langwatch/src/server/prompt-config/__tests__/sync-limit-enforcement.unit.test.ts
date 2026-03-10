import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LimitExceededError } from "~/server/license-enforcement/errors";

// Mock transitive dependencies that pull in generated types.
// The dsl module exports nodeDatasetSchema used by field-schemas.ts.
vi.mock("~/optimization_studio/types/dsl", async (importOriginal) => {
  const { z } = await import("zod");
  return {
    ...(await importOriginal<typeof import("~/optimization_studio/types/dsl")>().catch(() => ({}))),
    nodeDatasetSchema: z.any(),
  };
});

vi.mock("~/server/prompt-config/prompt-version.service");
vi.mock("~/server/prompt-config/repositories");
vi.mock("~/server/license-enforcement", () => ({
  createLicenseEnforcementService: vi.fn(),
}));

import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { PromptService } from "~/server/prompt-config/prompt.service";

describe("PromptService", () => {
  describe("syncPrompt()", () => {
    let promptService: PromptService;
    let mockPrisma: any;
    let mockRepository: any;
    let mockVersionService: any;
    let mockEnforceLimit: Mock;

    const localConfigData = {
      prompt: "Hello {input}",
      messages: [],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      model: "gpt-4",
      temperature: 0.7,
    } as any;

    beforeEach(() => {
      vi.clearAllMocks();

      mockEnforceLimit = vi.fn().mockResolvedValue(undefined);
      (createLicenseEnforcementService as Mock).mockReturnValue({
        enforceLimit: mockEnforceLimit,
      });

      mockPrisma = {
        $transaction: vi.fn(),
      } as any;

      mockRepository = {
        getConfigByIdOrHandleWithLatestVersion: vi.fn(),
        createConfigWithInitialVersion: vi.fn(),
        updateConfig: vi.fn(),
        compareConfigContent: vi.fn(),
        checkModifyPermission: vi.fn(),
        createHandle: vi.fn(),
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

    describe("when prompt does not exist on server", () => {
      beforeEach(() => {
        mockRepository.getConfigByIdOrHandleWithLatestVersion.mockResolvedValue(
          null,
        );
      });

      describe("when at resource limit", () => {
        beforeEach(() => {
          mockEnforceLimit.mockRejectedValue(
            new LimitExceededError("prompts", 5, 5),
          );
        });

        it("throws LimitExceededError", async () => {
          await expect(
            promptService.syncPrompt({
              idOrHandle: "new-prompt",
              localConfigData,
              projectId: "project-1",
              organizationId: "org-1",
            }),
          ).rejects.toThrow(LimitExceededError);

          expect(mockEnforceLimit).toHaveBeenCalledWith("org-1", "prompts");
        });
      });

      describe("when within resource limit", () => {
        beforeEach(() => {
          mockEnforceLimit.mockResolvedValue(undefined);
          mockRepository.createConfigWithInitialVersion.mockResolvedValue({
            id: "config-new",
            name: "new-prompt",
            handle: "new-prompt",
            scope: "PROJECT",
            projectId: "project-1",
            organizationId: "org-1",
            createdAt: new Date(),
            updatedAt: new Date(),
            latestVersion: {
              id: "version-1",
              version: 1,
              configData: localConfigData,
              createdAt: new Date(),
            },
          });
        });

        it("creates the prompt successfully", async () => {
          const result = await promptService.syncPrompt({
            idOrHandle: "new-prompt",
            localConfigData,
            projectId: "project-1",
            organizationId: "org-1",
          });

          expect(result.action).toBe("created");
          expect(mockEnforceLimit).toHaveBeenCalledWith("org-1", "prompts");
        });
      });
    });

    describe("when prompt already exists on server", () => {
      beforeEach(() => {
        const existingPrompt = {
          id: "config-existing",
          name: "existing-prompt",
          handle: "existing-prompt",
          scope: "PROJECT" as const,
          projectId: "project-1",
          organizationId: "org-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          latestVersion: {
            id: "version-1",
            version: 1,
            configData: localConfigData,
            createdAt: new Date(),
          },
        };
        mockRepository.getConfigByIdOrHandleWithLatestVersion.mockResolvedValue(
          existingPrompt,
        );
        mockRepository.compareConfigContent.mockReturnValue({
          isEqual: true,
          differences: [],
        });
        mockRepository.checkModifyPermission.mockResolvedValue({
          hasPermission: true,
        });
      });

      describe("when at resource limit", () => {
        beforeEach(() => {
          mockEnforceLimit.mockRejectedValue(
            new LimitExceededError("prompts", 5, 5),
          );
        });

        it("succeeds without enforcing limit", async () => {
          const result = await promptService.syncPrompt({
            idOrHandle: "existing-prompt",
            localConfigData,
            localVersion: 1,
            projectId: "project-1",
            organizationId: "org-1",
          });

          expect(result.action).toBe("up_to_date");
          expect(mockEnforceLimit).not.toHaveBeenCalled();
        });
      });
    });
  });
});
