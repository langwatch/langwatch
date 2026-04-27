import { describe, it, expect, beforeEach, vi } from "vitest";
import { PromptsApiService } from "../prompts-api.service";
import { PromptsFacade } from "../prompts.facade";
import { PromptsApiError } from "../errors";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { InternalConfig } from "@/client-sdk/types";
import type { LangwatchApiClient } from "@/internal/api/client";
import type { LocalPromptsService } from "../local-prompts.service";

describe("Prompt Tags", () => {
  describe("tags.assign()", () => {
    describe("when assigning a tag to a version", () => {
      let mockPut: ReturnType<typeof vi.fn>;
      let service: PromptsApiService;

      beforeEach(() => {
        mockPut = vi.fn();
        const apiClient = {
          GET: vi.fn(),
          POST: vi.fn(),
          PUT: mockPut,
          DELETE: vi.fn(),
        } as unknown as LangwatchApiClient;
        service = new PromptsApiService({
          langwatchApiClient: apiClient,
          logger: mock(),
        } as InternalConfig);
      });

      it("calls PUT /api/prompts/{id}/tags/{tag} with versionId", async () => {
        mockPut.mockResolvedValue({
          data: {
            configId: "config_abc",
            versionId: "prompt_version_abc123",
            tag: "production",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          error: undefined,
        });

        await service.assignTag({
          id: "pizza-prompt",
          tag: "production",
          versionId: "prompt_version_abc123",
        });

        expect(mockPut).toHaveBeenCalledWith(
          "/api/prompts/{id}/tags/{tag}",
          expect.objectContaining({
            params: expect.objectContaining({
              path: { id: "pizza-prompt", tag: "production" },
            }),
            body: { versionId: "prompt_version_abc123" },
          }),
        );
      });

      it("returns the assignment result with configId, versionId, tag, updatedAt", async () => {
        const expectedResult = {
          configId: "config_abc",
          versionId: "prompt_version_abc123",
          tag: "production",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        mockPut.mockResolvedValue({ data: expectedResult, error: undefined });

        const result = await service.assignTag({
          id: "pizza-prompt",
          tag: "production",
          versionId: "prompt_version_abc123",
        });

        expect(result).toEqual(expectedResult);
      });
    });

    describe("when the API returns an error", () => {
      let mockPut: ReturnType<typeof vi.fn>;
      let service: PromptsApiService;

      beforeEach(() => {
        mockPut = vi.fn();
        const apiClient = {
          GET: vi.fn(),
          POST: vi.fn(),
          PUT: mockPut,
          DELETE: vi.fn(),
        } as unknown as LangwatchApiClient;
        service = new PromptsApiService({
          langwatchApiClient: apiClient,
          logger: mock(),
        } as InternalConfig);
      });

      it("propagates the error", async () => {
        mockPut.mockResolvedValue({
          data: undefined,
          error: { error: "Prompt not found" },
        });

        await expect(
          service.assignTag({
            id: "pizza-prompt",
            tag: "production",
            versionId: "prompt_version_abc123",
          }),
        ).rejects.toThrow(PromptsApiError);
      });
    });

    describe("when accessed via PromptsFacade.tags.assign", () => {
      let promptsApiService: MockProxy<PromptsApiService>;
      let facade: PromptsFacade;
      let localPromptsService: MockProxy<LocalPromptsService>;

      beforeEach(() => {
        promptsApiService = mock<PromptsApiService>();
        localPromptsService = mock<LocalPromptsService>();
        facade = new PromptsFacade({
          promptsApiService,
          localPromptsService,
          langwatchApiClient: {} as InternalConfig["langwatchApiClient"],
          logger: {} as InternalConfig["logger"],
        });
      });

      it("delegates to PromptsApiService.assignTag", async () => {
        const expectedResult = {
          configId: "config_abc",
          versionId: "prompt_version_abc123",
          tag: "production",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        promptsApiService.assignTag.mockResolvedValue(expectedResult);

        const result = await facade.tags.assign("pizza-prompt", {
          tag: "production",
          versionId: "prompt_version_abc123",
        });

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(promptsApiService.assignTag).toHaveBeenCalledWith({
          id: "pizza-prompt",
          tag: "production",
          versionId: "prompt_version_abc123",
        });
        expect(result).toEqual(expectedResult);
      });
    });
  });
});
