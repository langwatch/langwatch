import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptService, type VersionedPrompt } from "../prompt.service";

/**
 * Tests for syncPrompt covering:
 * - Root Cause 1: remoteConfigData must include ALL sampling parameters
 * - Root Cause 3: double transformToDbFormat on create path
 */
describe("PromptService", () => {
  describe("syncPrompt()", () => {
    let promptService: PromptService;
    let mockPrisma: any;
    let mockRepository: any;
    let mockVersionService: any;

    const projectId = "project-1";
    const organizationId = "org-1";

    /**
     * Build a VersionedPrompt with all sampling parameters populated.
     */
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
        maxTokens: 1000,
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
        topK: 40,
        minP: 0.1,
        repetitionPenalty: 1.1,
        reasoning: "medium",
        verbosity: "normal",
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

    describe("when remote prompt exists with all sampling parameters and local matches", () => {
      it("returns up_to_date when max_tokens, top_p, and other params match", async () => {
        const existingPrompt = buildExistingPrompt();

        // Spy on getPromptByIdOrHandle to return our prompt with all params
        vi.spyOn(promptService, "getPromptByIdOrHandle").mockResolvedValue(
          existingPrompt,
        );

        // The local config data matches what the server has (in snake_case DB format)
        const localConfigData = {
          model: "gpt-4",
          prompt: "You are a helpful assistant",
          messages: [{ role: "user" as const, content: "Hello {{input}}" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          temperature: 0.7,
          max_tokens: 1000,
          top_p: 0.9,
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          seed: 42,
          top_k: 40,
          min_p: 0.1,
          repetition_penalty: 1.1,
          reasoning: "medium",
          verbosity: "normal",
        };

        // The comparison should see them as equal
        mockRepository.compareConfigContent.mockReturnValue({ isEqual: true });

        const result = await promptService.syncPrompt({
          idOrHandle: "test-prompt",
          localConfigData: localConfigData as any,
          localVersion: 1,
          projectId,
          organizationId,
        });

        expect(result.action).toBe("up_to_date");

        // Verify that compareConfigContent was called with remoteConfigData
        // that includes ALL sampling parameters, not just temperature
        const [, remoteArg] =
          mockRepository.compareConfigContent.mock.calls[0]!;
        expect(remoteArg).toHaveProperty("max_tokens", 1000);
        expect(remoteArg).toHaveProperty("top_p", 0.9);
        expect(remoteArg).toHaveProperty("frequency_penalty", 0.5);
        expect(remoteArg).toHaveProperty("presence_penalty", 0.3);
        expect(remoteArg).toHaveProperty("seed", 42);
        expect(remoteArg).toHaveProperty("top_k", 40);
        expect(remoteArg).toHaveProperty("min_p", 0.1);
        expect(remoteArg).toHaveProperty("repetition_penalty", 1.1);
        expect(remoteArg).toHaveProperty("reasoning", "medium");
        expect(remoteArg).toHaveProperty("verbosity", "normal");
      });
    });

    describe("when remote prompt exists with only some sampling params defined", () => {
      it("excludes undefined sampling parameters from remoteConfigData", async () => {
        const existingPrompt = buildExistingPrompt({
          maxTokens: undefined,
          topP: undefined,
          frequencyPenalty: undefined,
          presencePenalty: undefined,
          seed: undefined,
          topK: undefined,
          minP: undefined,
          repetitionPenalty: undefined,
          reasoning: undefined,
          verbosity: undefined,
        });

        vi.spyOn(promptService, "getPromptByIdOrHandle").mockResolvedValue(
          existingPrompt,
        );

        const localConfigData = {
          model: "gpt-4",
          prompt: "You are a helpful assistant",
          messages: [{ role: "user" as const, content: "Hello {{input}}" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          temperature: 0.7,
        };

        mockRepository.compareConfigContent.mockReturnValue({ isEqual: true });

        await promptService.syncPrompt({
          idOrHandle: "test-prompt",
          localConfigData: localConfigData as any,
          localVersion: 1,
          projectId,
          organizationId,
        });

        // remoteConfigData should NOT include undefined fields (to avoid false diffs)
        const [, remoteArg] =
          mockRepository.compareConfigContent.mock.calls[0]!;
        expect(remoteArg).not.toHaveProperty("max_tokens");
        expect(remoteArg).not.toHaveProperty("top_p");
        expect(remoteArg).not.toHaveProperty("frequency_penalty");
        expect(remoteArg).not.toHaveProperty("presence_penalty");
        expect(remoteArg).not.toHaveProperty("seed");
      });
    });

    describe("when prompt does not exist and is created", () => {
      it("does not double-transform camelCase params through transformToDbFormat", async () => {
        vi.spyOn(promptService, "getPromptByIdOrHandle").mockResolvedValue(
          null,
        );

        const createdPrompt = buildExistingPrompt({ version: 1 });
        const createSpy = vi
          .spyOn(promptService, "createPrompt")
          .mockResolvedValue(createdPrompt);

        const localConfigData = {
          model: "gpt-4",
          prompt: "You are a helpful assistant",
          messages: [{ role: "user" as const, content: "Hello {{input}}" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          temperature: 0.7,
          max_tokens: 1000,
        };

        await promptService.syncPrompt({
          idOrHandle: "test-prompt",
          localConfigData: localConfigData as any,
          projectId,
          organizationId,
        });

        // createPrompt should receive camelCase params (since createPrompt
        // internally calls transformToDbFormat). The data must NOT already be
        // snake_case'd, otherwise max_tokens becomes undefined after the
        // double transform.
        expect(createSpy).toHaveBeenCalledTimes(1);
        const createArgs = createSpy.mock.calls[0]![0];

        // After transformToDbFormat, snake_case keys like max_tokens should be
        // passed through. The key check is that max_tokens/maxTokens is present
        // in some form and not lost.
        const hasMaxTokens =
          "maxTokens" in createArgs || "max_tokens" in createArgs;
        expect(hasMaxTokens).toBe(true);

        // The value should be 1000, not undefined
        const maxTokensValue =
          (createArgs as any).maxTokens ?? (createArgs as any).max_tokens;
        expect(maxTokensValue).toBe(1000);
      });
    });
  });
});
