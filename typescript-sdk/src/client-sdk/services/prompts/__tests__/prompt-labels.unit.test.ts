import { describe, it, expect, beforeEach, vi } from "vitest";
import { PromptsApiService } from "../prompts-api.service";
import { PromptsFacade } from "../prompts.facade";
import { PromptsApiError } from "../errors";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { InternalConfig } from "@/client-sdk/types";
import type { LangwatchApiClient } from "@/internal/api/client";
import type { LocalPromptsService } from "../local-prompts.service";

describe("Prompt Labels", () => {
  describe("labels.assign()", () => {
    describe("when assigning a label to a version", () => {
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

      it("calls PUT /api/prompts/{id}/labels/{label} with versionId", async () => {
        mockPut.mockResolvedValue({
          data: {
            configId: "config_abc",
            versionId: "prompt_version_abc123",
            label: "production",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          error: undefined,
        });

        await service.assignLabel({
          id: "pizza-prompt",
          label: "production",
          versionId: "prompt_version_abc123",
        });

        expect(mockPut).toHaveBeenCalledWith(
          "/api/prompts/{id}/labels/{label}",
          expect.objectContaining({
            params: expect.objectContaining({
              path: { id: "pizza-prompt", label: "production" },
            }),
            body: { versionId: "prompt_version_abc123" },
          }),
        );
      });

      it("returns the assignment result with configId, versionId, label, updatedAt", async () => {
        const expectedResult = {
          configId: "config_abc",
          versionId: "prompt_version_abc123",
          label: "production",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        mockPut.mockResolvedValue({ data: expectedResult, error: undefined });

        const result = await service.assignLabel({
          id: "pizza-prompt",
          label: "production",
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
          service.assignLabel({
            id: "pizza-prompt",
            label: "production",
            versionId: "prompt_version_abc123",
          }),
        ).rejects.toThrow(PromptsApiError);
      });
    });

    describe("when accessed via PromptsFacade.labels.assign", () => {
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

      it("delegates to PromptsApiService.assignLabel", async () => {
        const expectedResult = {
          configId: "config_abc",
          versionId: "prompt_version_abc123",
          label: "production",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        promptsApiService.assignLabel.mockResolvedValue(expectedResult);

        const result = await facade.labels.assign("pizza-prompt", {
          label: "production",
          versionId: "prompt_version_abc123",
        });

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(promptsApiService.assignLabel).toHaveBeenCalledWith({
          id: "pizza-prompt",
          label: "production",
          versionId: "prompt_version_abc123",
        });
        expect(result).toEqual(expectedResult);
      });
    });
  });
});
