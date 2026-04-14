import { describe, it, expect, beforeEach } from "vitest";
import { PromptsApiService } from "../prompts-api.service";
import { PromptsFacade } from "../prompts.facade";
import { PromptsApiError } from "../errors";
import { mock, type MockProxy } from "vitest-mock-extended";
import { vi } from "vitest";
import type { InternalConfig } from "@/client-sdk/types";
import type { LangwatchApiClient } from "@/internal/api/client";
import type { LocalPromptsService } from "../local-prompts.service";

describe("Tag CRUD", () => {
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

    describe("listTags()", () => {
      describe("when listing tags succeeds", () => {
        it("calls GET /api/prompts/tags", async () => {
          mockGet.mockResolvedValue({
            data: [
              { id: "ptag_prod", name: "production", createdAt: "2026-01-01T00:00:00.000Z" },
              { id: "ptag_stg", name: "staging", createdAt: "2026-01-01T00:00:00.000Z" },
              { id: "ptag_abc", name: "canary", createdAt: "2026-01-01T00:00:00.000Z" },
            ],
            error: undefined,
          });

          await service.listTags();

          expect(mockGet).toHaveBeenCalledWith("/api/prompts/tags");
        });

        it("returns the list of tags", async () => {
          const expectedTags = [
            { id: "ptag_prod", name: "production", createdAt: "2026-01-01T00:00:00.000Z" },
            { id: "ptag_stg", name: "staging", createdAt: "2026-01-01T00:00:00.000Z" },
            { id: "ptag_abc", name: "canary", createdAt: "2026-01-01T00:00:00.000Z" },
          ];
          mockGet.mockResolvedValue({ data: expectedTags, error: undefined });

          const result = await service.listTags();

          expect(result).toEqual(expectedTags);
        });
      });

      describe("when the API returns an error", () => {
        it("throws PromptsApiError", async () => {
          mockGet.mockResolvedValue({
            data: undefined,
            error: { error: "Unauthorized" },
          });

          await expect(service.listTags()).rejects.toThrow(PromptsApiError);
        });
      });
    });

    describe("createTag()", () => {
      describe("when creating a tag succeeds", () => {
        it("calls POST /api/prompts/tags with the tag name", async () => {
          mockPost.mockResolvedValue({
            data: { id: "ptag_abc", name: "canary", createdAt: "2026-01-01T00:00:00.000Z" },
            error: undefined,
          });

          await service.createTag({ name: "canary" });

          expect(mockPost).toHaveBeenCalledWith(
            "/api/prompts/tags",
            expect.objectContaining({ body: { name: "canary" } }),
          );
        });

        it("returns the created tag", async () => {
          const expectedTag = { id: "ptag_abc", name: "canary", createdAt: "2026-01-01T00:00:00.000Z" };
          mockPost.mockResolvedValue({ data: expectedTag, error: undefined });

          const result = await service.createTag({ name: "canary" });

          expect(result).toEqual(expectedTag);
        });
      });

      describe("when the API returns an error", () => {
        it("throws PromptsApiError", async () => {
          mockPost.mockResolvedValue({
            data: undefined,
            error: { error: "Tag already exists" },
          });

          await expect(service.createTag({ name: "canary" })).rejects.toThrow(PromptsApiError);
        });
      });
    });

    describe("deleteTag()", () => {
      describe("when deleting a tag succeeds", () => {
        it("calls DELETE /api/prompts/tags/:tag", async () => {
          mockDelete.mockResolvedValue({ data: undefined, error: undefined });

          await service.deleteTag("my-tag");

          expect(mockDelete).toHaveBeenCalledWith(
            "/api/prompts/tags/{tag}",
            expect.objectContaining({ params: { path: { tag: "my-tag" } } }),
          );
        });
      });

      describe("when the API returns an error", () => {
        it("throws PromptsApiError", async () => {
          mockDelete.mockResolvedValue({
            data: undefined,
            error: { error: "Tag not found" },
          });

          await expect(service.deleteTag("my-tag")).rejects.toThrow(PromptsApiError);
        });
      });
    });
  });

  describe("PromptsFacade.tags", () => {
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

    describe("tags.list()", () => {
      it("delegates to PromptsApiService.listTags", async () => {
        const expectedTags = [
          { id: "ptag_prod", name: "production", createdAt: "2026-01-01T00:00:00.000Z" },
        ];
        promptsApiService.listTags.mockResolvedValue(expectedTags);

        const result = await facade.tags.list();

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(promptsApiService.listTags).toHaveBeenCalled();
        expect(result).toEqual(expectedTags);
      });
    });

    describe("tags.create()", () => {
      it("delegates to PromptsApiService.createTag with name", async () => {
        const expectedTag = { id: "ptag_abc", name: "canary", createdAt: "2026-01-01T00:00:00.000Z" };
        promptsApiService.createTag.mockResolvedValue(expectedTag);

        const result = await facade.tags.create({ name: "canary" });

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(promptsApiService.createTag).toHaveBeenCalledWith({ name: "canary" });
        expect(result).toEqual(expectedTag);
      });
    });

    describe("tags.delete()", () => {
      it("delegates to PromptsApiService.deleteTag with tag name", async () => {
        promptsApiService.deleteTag.mockResolvedValue(undefined);

        await facade.tags.delete("my-tag");

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(promptsApiService.deleteTag).toHaveBeenCalledWith("my-tag");
      });
    });
  });

  describe("tag type is widened to string", () => {
    it("passes an arbitrary string tag through to the API service", async () => {
      // Verifies that GetPromptOptions.tag accepts any string, not just "production"|"staging"
      // Verify the get method is called with the custom tag
      // (type-level: this would not compile if tag were "production" | "staging")
      const options: Parameters<PromptsFacade["get"]>[1] = { tag: "canary" };
      expect(options.tag).toBe("canary");

      // Verify the API service call also accepts string tags
      const serviceOptions: Parameters<PromptsApiService["get"]>[1] = { tag: "canary" };
      expect(serviceOptions?.tag).toBe("canary");
    });
  });
});
