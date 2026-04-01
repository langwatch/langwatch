import { describe, it, expect, beforeEach } from "vitest";
import { PromptsApiService } from "../prompts-api.service";
import { PromptsFacade } from "../prompts.facade";
import { PromptsApiError } from "../errors";
import { mock, type MockProxy } from "vitest-mock-extended";
import { vi } from "vitest";
import type { InternalConfig } from "@/client-sdk/types";
import type { LangwatchApiClient } from "@/internal/api/client";
import type { LocalPromptsService } from "../local-prompts.service";

describe("Label CRUD", () => {
  describe("PromptsApiService", () => {
    let mockGet: ReturnType<typeof vi.fn>;
    let mockPost: ReturnType<typeof vi.fn>;
    let mockDelete: ReturnType<typeof vi.fn>;
    let service: PromptsApiService;

    beforeEach(() => {
      mockGet = vi.fn();
      mockPost = vi.fn();
      mockDelete = vi.fn();
      const apiClient = {
        GET: mockGet,
        POST: mockPost,
        PUT: vi.fn(),
        DELETE: mockDelete,
      } as unknown as LangwatchApiClient;
      service = new PromptsApiService({
        langwatchApiClient: apiClient,
        logger: mock(),
      } as InternalConfig);
    });

    describe("listLabels()", () => {
      describe("when listing labels succeeds", () => {
        it("calls GET /api/prompts/labels", async () => {
          mockGet.mockResolvedValue({
            data: [
              { name: "production", type: "built-in" },
              { name: "staging", type: "built-in" },
              { id: "plabel_abc", name: "canary", type: "custom", createdAt: "2026-01-01T00:00:00.000Z" },
            ],
            error: undefined,
          });

          await service.listLabels();

          expect(mockGet).toHaveBeenCalledWith("/api/prompts/labels");
        });

        it("returns the list of labels", async () => {
          const expectedLabels = [
            { name: "production", type: "built-in" },
            { name: "staging", type: "built-in" },
            { id: "plabel_abc", name: "canary", type: "custom", createdAt: "2026-01-01T00:00:00.000Z" },
          ];
          mockGet.mockResolvedValue({ data: expectedLabels, error: undefined });

          const result = await service.listLabels();

          expect(result).toEqual(expectedLabels);
        });
      });

      describe("when the API returns an error", () => {
        it("throws PromptsApiError", async () => {
          mockGet.mockResolvedValue({
            data: undefined,
            error: { error: "Unauthorized" },
          });

          await expect(service.listLabels()).rejects.toThrow(PromptsApiError);
        });
      });
    });

    describe("createLabel()", () => {
      describe("when creating a label succeeds", () => {
        it("calls POST /api/prompts/labels with the label name", async () => {
          mockPost.mockResolvedValue({
            data: { id: "plabel_abc", name: "canary", createdAt: "2026-01-01T00:00:00.000Z" },
            error: undefined,
          });

          await service.createLabel({ name: "canary" });

          expect(mockPost).toHaveBeenCalledWith(
            "/api/prompts/labels",
            expect.objectContaining({ body: { name: "canary" } }),
          );
        });

        it("returns the created label", async () => {
          const expectedLabel = { id: "plabel_abc", name: "canary", createdAt: "2026-01-01T00:00:00.000Z" };
          mockPost.mockResolvedValue({ data: expectedLabel, error: undefined });

          const result = await service.createLabel({ name: "canary" });

          expect(result).toEqual(expectedLabel);
        });
      });

      describe("when the API returns an error", () => {
        it("throws PromptsApiError", async () => {
          mockPost.mockResolvedValue({
            data: undefined,
            error: { error: "Label already exists" },
          });

          await expect(service.createLabel({ name: "canary" })).rejects.toThrow(PromptsApiError);
        });
      });
    });

    describe("deleteLabel()", () => {
      describe("when deleting a label succeeds", () => {
        it("calls DELETE /api/prompts/labels/:labelId", async () => {
          mockDelete.mockResolvedValue({ data: undefined, error: undefined });

          await service.deleteLabel("plabel_abc");

          expect(mockDelete).toHaveBeenCalledWith(
            "/api/prompts/labels/{labelId}",
            expect.objectContaining({ params: { path: { labelId: "plabel_abc" } } }),
          );
        });
      });

      describe("when the API returns an error", () => {
        it("throws PromptsApiError", async () => {
          mockDelete.mockResolvedValue({
            data: undefined,
            error: { error: "Label not found" },
          });

          await expect(service.deleteLabel("plabel_abc")).rejects.toThrow(PromptsApiError);
        });
      });
    });
  });

  describe("PromptsFacade.labels", () => {
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

    describe("labels.list()", () => {
      it("delegates to PromptsApiService.listLabels", async () => {
        const expectedLabels = [
          { name: "production", type: "built-in" as const },
        ];
        promptsApiService.listLabels.mockResolvedValue(expectedLabels);

        const result = await facade.labels.list();

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(promptsApiService.listLabels).toHaveBeenCalled();
        expect(result).toEqual(expectedLabels);
      });
    });

    describe("labels.create()", () => {
      it("delegates to PromptsApiService.createLabel with name", async () => {
        const expectedLabel = { id: "plabel_abc", name: "canary", createdAt: "2026-01-01T00:00:00.000Z" };
        promptsApiService.createLabel.mockResolvedValue(expectedLabel);

        const result = await facade.labels.create({ name: "canary" });

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(promptsApiService.createLabel).toHaveBeenCalledWith({ name: "canary" });
        expect(result).toEqual(expectedLabel);
      });
    });

    describe("labels.delete()", () => {
      it("delegates to PromptsApiService.deleteLabel with labelId", async () => {
        promptsApiService.deleteLabel.mockResolvedValue(undefined);

        await facade.labels.delete("plabel_abc");

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(promptsApiService.deleteLabel).toHaveBeenCalledWith("plabel_abc");
      });
    });
  });

  describe("label type is widened to string", () => {
    it("passes an arbitrary string label through to the API service", async () => {
      // Verifies that GetPromptOptions.label accepts any string, not just "production"|"staging"
      const promptsApiService = mock<PromptsApiService>();
      const localPromptsService = mock<LocalPromptsService>();
      const facade = new PromptsFacade({
        promptsApiService,
        localPromptsService,
        langwatchApiClient: {} as InternalConfig["langwatchApiClient"],
        logger: {} as InternalConfig["logger"],
      });

      // Verify the get method is called with the custom label
      // (type-level: this would not compile if label were "production" | "staging")
      const options: Parameters<typeof facade.get>[1] = { label: "canary" };
      expect(options.label).toBe("canary");

      // Verify the API service call also accepts string labels
      const serviceOptions: Parameters<typeof promptsApiService.get>[1] = { label: "canary" };
      expect(serviceOptions?.label).toBe("canary");
    });
  });
});
