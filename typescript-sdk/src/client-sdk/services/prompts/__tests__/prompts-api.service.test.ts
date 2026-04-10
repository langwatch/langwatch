import { describe, it, expect, beforeEach, vi } from "vitest";
import { PromptsApiService } from "../prompts-api.service";
import { PromptsApiError } from "../errors";
import { mock } from "vitest-mock-extended";
import type { InternalConfig } from "@/client-sdk/types";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import type { LangwatchApiClient } from "@/internal/api/client";

describe("PromptsApiService.renameTag", () => {
  let service: PromptsApiService;
  let mockPut: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPut = vi.fn();
    const apiClient = {
      PUT: mockPut,
    } as unknown as LangwatchApiClient;
    service = new PromptsApiService({
      langwatchApiClient: apiClient,
      logger: mock(),
    } as InternalConfig);
  });

  it("calls PUT /api/prompts/tags/{tag} with new name", async () => {
    mockPut.mockResolvedValue({ data: undefined, error: undefined });
    await service.renameTag({ tag: "old-name", name: "new-name" });
    expect(mockPut).toHaveBeenCalledWith(
      "/api/prompts/tags/{tag}",
      expect.objectContaining({
        params: expect.objectContaining({ path: { tag: "old-name" } }),
        body: { name: "new-name" },
      }),
    );
  });

  describe("when the API returns an error", () => {
    it("throws PromptsApiError", async () => {
      mockPut.mockResolvedValue({ data: undefined, error: "tag not found" });
      await expect(service.renameTag({ tag: "old-name", name: "new-name" })).rejects.toThrow(PromptsApiError);
    });
  });
});

describe("PromptsApiService.get", () => {
  let service: PromptsApiService;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGet = vi.fn();
    const apiClient = {
      GET: mockGet,
    } as unknown as LangwatchApiClient;
    service = new PromptsApiService({
      langwatchApiClient: apiClient,
      logger: mock(),
    } as InternalConfig);
  });

  describe("when fetching with a tag", () => {
    it("passes tag as query parameter to the API", async () => {
      const mockPrompt = promptResponseFactory.build();
      mockGet.mockResolvedValue({ data: mockPrompt, error: undefined });

      await service.get("pizza-prompt", { tag: "production" });

      expect(mockGet).toHaveBeenCalledWith(
        "/api/prompts/{id}",
        expect.objectContaining({
          params: expect.objectContaining({
            path: { id: "pizza-prompt" },
            query: expect.objectContaining({ tag: "production" }),
          }),
        }),
      );
    });

    it("passes both tag and version to the API when both provided", async () => {
      const mockPrompt = promptResponseFactory.build();
      mockGet.mockResolvedValue({ data: mockPrompt, error: undefined });

      await service.get("pizza-prompt", { tag: "production", version: "3" });

      expect(mockGet).toHaveBeenCalledWith(
        "/api/prompts/{id}",
        expect.objectContaining({
          params: expect.objectContaining({
            path: { id: "pizza-prompt" },
            query: expect.objectContaining({ tag: "production", version: 3 }),
          }),
        }),
      );
    });
  });
});

describe("PromptsApiService.handleApiError", () => {
  let service: PromptsApiService;
  let handleApiError: typeof PromptsApiService.prototype["handleApiError"];

  beforeEach(() => {
    service = new PromptsApiService({
      langwatchApiClient: mock(),
      logger: mock(),
    } as InternalConfig);
    // @ts-expect-error - handleApiError is private but we need to bind it to the service
    handleApiError = service.handleApiError.bind(service);
  });

  it("extracts string error", () => {
    expect(() =>
      handleApiError("test operation", "simple error")
    ).toThrow(PromptsApiError);

    try {
      handleApiError("test operation", "simple error");
    } catch (error) {
      expect(error).toBeInstanceOf(PromptsApiError);
      expect((error as PromptsApiError).message).toBe("Failed to test operation: simple error");
      expect((error as PromptsApiError).operation).toBe("test operation");
    }
  });

  it("extracts nested error.error as string", () => {
    const error = { error: "nested error string" };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsApiError);
      expect((e as PromptsApiError).message).toBe("Failed to test operation: nested error string");
    }
  });

  it("extracts error.error.message", () => {
    const error = { error: { message: "nested error message" } };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsApiError);
      expect((e as PromptsApiError).message).toBe("Failed to test operation: nested error message");
    }
  });

  it("serializes error.error object when no message", () => {
    const error = { error: { code: 404, detail: "not found" } };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsApiError);
      expect((e as PromptsApiError).message).toContain("404");
      expect((e as PromptsApiError).message).toContain("not found");
    }
  });

  it("extracts error.message when no error.error", () => {
    const error = { message: "direct error message" };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsApiError);
      expect((e as PromptsApiError).message).toBe("Failed to test operation: direct error message");
    }
  });

  it("uses unknown error when no extractable message", () => {
    const error = {};

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsApiError);
      expect((e as PromptsApiError).message).toBe("Failed to test operation: Unknown error occurred");
    }
  });

  it("serializes Error objects properly (not [object Object])", () => {
    const error = { error: new Error("native error") };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsApiError);
      expect((e as PromptsApiError).message).not.toContain("[object Object]");
      expect((e as PromptsApiError).message).toContain("native error");
    }
  });

  it("serializes objects with non-enumerable properties", () => {
    const errorObj = Object.create(null);
    Object.defineProperty(errorObj, "code", {
      value: "ERR_BAD_REQUEST",
      enumerable: false,
    });
    Object.defineProperty(errorObj, "status", {
      value: 400,
      enumerable: false,
    });
    const error = { error: errorObj };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsApiError);
      expect((e as PromptsApiError).message).not.toContain("[object Object]");
      // Should contain the properties thanks to Object.getOwnPropertyNames
      expect((e as PromptsApiError).message).toContain("ERR_BAD_REQUEST");
      expect((e as PromptsApiError).message).toContain("400");
    }
  });

  it("handles complex nested objects without [object Object]", () => {
    const error = {
      error: {
        data: { user: "test", nested: { deep: "value" } },
        code: 500,
      },
    };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsApiError);
      expect((e as PromptsApiError).message).not.toContain("[object Object]");
      expect((e as PromptsApiError).message).toContain("500");
    }
  });
});

