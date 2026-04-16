import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptService, type VersionedPrompt } from "../prompt.service";

describe("PromptService", () => {
  describe("syncPrompt()", () => {
    let promptService: PromptService;
    let mockPrisma: any;
    let mockRepository: any;
    let mockVersionService: any;

    const projectId = "project-1";
    const organizationId = "org-1";

    function buildExistingPrompt(
      overrides: Partial<VersionedPrompt> = {},
    ): VersionedPrompt {
      return {
        id: "config-1",
        name: "test-prompt",
        handle: "test-prompt",
        scope: "PROJECT" as const,
        version: 1,
        versionId: "version-1",
        versionCreatedAt: new Date(),
        model: "gpt-4",
        temperature: 0.7,
        prompt: "You are a helpful assistant",
        projectId,
        organizationId,
        messages: [
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "Hello {{input}}" },
        ],
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        authorId: null,
        updatedAt: new Date(),
        createdAt: new Date(),
        tags: [],
        ...overrides,
      };
    }

    beforeEach(() => {
      vi.clearAllMocks();

      mockPrisma = {
        $transaction: vi.fn(),
        project: {
          findUnique: vi.fn(),
        },
      } as any;

      mockRepository = {
        compareConfigContent: vi.fn(),
        getConfigVersionByNumber: vi.fn(),
        getConfigByIdOrHandleWithLatestVersion: vi.fn(),
        checkModifyPermission: vi.fn().mockResolvedValue({
          hasPermission: true,
        }),
        createConfigWithInitialVersion: vi.fn(),
        updateConfig: vi.fn(),
        versions: {
          getLatestVersion: vi.fn(),
        },
        createHandle: vi.fn(),
      };

      mockVersionService = {
        assertNoSystemPromptConflict: vi.fn(),
        createVersion: vi.fn(),
      };

      promptService = new PromptService(mockPrisma);
      (promptService as any).repository = mockRepository;
      (promptService as any).versionService = mockVersionService;
    });

    describe("given a prompt with auto-detected variables already synced", () => {
      describe("when the same prompt is synced again with the same text", () => {
        it("returns up_to_date because auto-detected inputs match stored inputs", async () => {
          // Remote has the auto-detected input from previous sync
          const existingPrompt = buildExistingPrompt({
            prompt: "hello {{name}}",
            messages: [{ role: "system", content: "hello {{name}}" }],
            inputs: [{ identifier: "name", type: "str" as const }],
          });

          vi.spyOn(
            promptService,
            "getPromptByIdOrHandle",
          ).mockResolvedValue(existingPrompt);

          mockRepository.compareConfigContent.mockReturnValue({
            isEqual: true,
          });

          const result = await promptService.syncPrompt({
            idOrHandle: "test-prompt",
            localConfigData: {
              model: "gpt-4",
              prompt: "hello {{name}}",
              messages: [],
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
              temperature: 0.7,
            } as any,
            localVersion: 1,
            projectId,
            organizationId,
          });

          expect(result.action).toBe("up_to_date");

          // Verify the local config data passed to compare has the auto-detected
          // inputs merged and sorted, not just the CLI default
          const [localArg] =
            mockRepository.compareConfigContent.mock.calls[0]!;
          const inputIdentifiers = (localArg.inputs as any[]).map(
            (i: any) => i.identifier,
          );
          expect(inputIdentifiers).toContain("input");
          expect(inputIdentifiers).toContain("name");
        });
      });
    });

    describe("given a prompt where variable order changes in template text", () => {
      describe("when synced with reordered variables but same variable set", () => {
        it("returns up_to_date because inputs are sorted alphabetically", async () => {
          // Remote was synced with "alpha" and "zebra" (sorted)
          const existingPrompt = buildExistingPrompt({
            prompt: "{{alpha}} {{zebra}}",
            messages: [
              { role: "system", content: "{{alpha}} {{zebra}}" },
            ],
            inputs: [
              { identifier: "alpha", type: "str" as const },
              { identifier: "zebra", type: "str" as const },
            ],
          });

          vi.spyOn(
            promptService,
            "getPromptByIdOrHandle",
          ).mockResolvedValue(existingPrompt);

          mockRepository.compareConfigContent.mockReturnValue({
            isEqual: true,
          });

          // Now sync with "zebra" before "alpha" in template text
          const result = await promptService.syncPrompt({
            idOrHandle: "test-prompt",
            localConfigData: {
              model: "gpt-4",
              prompt: "{{zebra}} {{alpha}}",
              messages: [],
              inputs: [],
              outputs: [{ identifier: "output", type: "str" }],
            } as any,
            localVersion: 1,
            projectId,
            organizationId,
          });

          expect(result.action).toBe("up_to_date");

          // Verify both local and remote inputs are sorted identically
          const [localArg, remoteArg] =
            mockRepository.compareConfigContent.mock.calls[0]!;
          const localIdentifiers = (localArg.inputs as any[]).map(
            (i: any) => i.identifier,
          );
          const remoteIdentifiers = (remoteArg.inputs as any[]).map(
            (i: any) => i.identifier,
          );
          expect(localIdentifiers).toEqual(["alpha", "zebra"]);
          expect(remoteIdentifiers).toEqual(["alpha", "zebra"]);
        });
      });
    });

    describe("given a new prompt that does not exist on the server", () => {
      describe("when synced with template variables", () => {
        it("creates the prompt with auto-detected inputs merged", async () => {
          vi.spyOn(
            promptService,
            "getPromptByIdOrHandle",
          ).mockResolvedValue(null);

          const createdPrompt = buildExistingPrompt({ version: 1 });
          const createSpy = vi
            .spyOn(promptService, "createPrompt")
            .mockResolvedValue(createdPrompt);

          const result = await promptService.syncPrompt({
            idOrHandle: "test-prompt",
            localConfigData: {
              model: "gpt-4",
              prompt: "hello {{name}}",
              messages: [{ role: "user", content: "{{task}}" }],
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            } as any,
            projectId,
            organizationId,
          });

          expect(result.action).toBe("created");

          // Verify the create call got auto-detected inputs merged
          const createArgs = createSpy.mock.calls[0]![0];
          const inputIdentifiers = (createArgs.inputs as any[]).map(
            (i: any) => i.identifier,
          );
          expect(inputIdentifiers).toContain("input");
          expect(inputIdentifiers).toContain("name");
          expect(inputIdentifiers).toContain("task");
          // Should be sorted alphabetically
          expect(inputIdentifiers).toEqual([...inputIdentifiers].sort());
        });
      });
    });
  });
});
