import { describe, it, expect, beforeEach, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { InternalConfig } from "@/client-sdk/types";
import type { LangwatchApiClient } from "@/internal/api/client";

import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import { PromptsApiError } from "../errors";
import { PromptsApiService } from "../prompts-api.service";

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

  /** @scenario renameTag calls PUT /api/v1/prompts/tags/{tag} with new name */
  it("calls PUT /api/v1/prompts/tags/{tag} with new name", async () => {
    mockPut.mockResolvedValue({ data: undefined, error: undefined });
    await service.renameTag({ tag: "old-name", name: "new-name" });
    expect(mockPut).toHaveBeenCalledWith(
      "/api/v1/prompts/tags/{tag}",
      expect.objectContaining({
        params: expect.objectContaining({ path: { tag: "old-name" } }),
        body: { name: "new-name" },
      }),
    );
  });

  describe("when the API returns an error", () => {
    it("throws PromptsApiError", async () => {
      mockPut.mockResolvedValue({ data: undefined, error: "tag not found" });
      await expect(service.renameTag({ tag: "old-name", name: "new-name" })).rejects.toThrow(
        PromptsApiError,
      );
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
    /** @scenario passes tag as query parameter to the API */
    it("passes tag as query parameter to the API", async () => {
      const mockPrompt = promptResponseFactory.build();
      mockGet.mockResolvedValue({ data: mockPrompt, error: undefined });

      await service.get("pizza-prompt", { tag: "production" });

      expect(mockGet).toHaveBeenCalledWith(
        "/api/v1/prompts/{id}",
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
        "/api/v1/prompts/{id}",
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

describe("PromptsApiService.sync", () => {
  let service: PromptsApiService;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPost = vi.fn();
    const apiClient = {
      POST: mockPost,
    } as unknown as LangwatchApiClient;
    service = new PromptsApiService({
      langwatchApiClient: apiClient,
      logger: mock(),
    } as InternalConfig);
  });

  const syncArgs = {
    name: "x",
    configData: { handle: "x" } as any,
    localVersion: 1,
    commitMessage: "test",
  };

  describe("when the server returns a valid payload", () => {
    it("parses and returns the sync result", async () => {
      mockPost.mockResolvedValue({
        data: { action: "up_to_date" },
        error: undefined,
      });

      const result = await service.sync(syncArgs);

      expect(result.action).toBe("up_to_date");
    });
  });

  describe("when the server returns a malformed 2xx payload", () => {
    it("throws PromptsApiError instead of letting undefined fields leak downstream", async () => {
      mockPost.mockResolvedValue({
        data: { action: undefined },
        error: undefined,
      });

      await expect(service.sync(syncArgs)).rejects.toThrow(PromptsApiError);
      await expect(service.sync(syncArgs)).rejects.toThrow(/invalid response body/);
    });

    it("throws PromptsApiError when data is missing entirely", async () => {
      mockPost.mockResolvedValue({ data: undefined, error: undefined });

      await expect(service.sync(syncArgs)).rejects.toThrow(PromptsApiError);
    });

    it("throws PromptsApiError when action is an unknown enum value", async () => {
      mockPost.mockResolvedValue({
        data: { action: "exploded" },
        error: undefined,
      });

      await expect(service.sync(syncArgs)).rejects.toThrow(PromptsApiError);
    });
  });
});

describe("PromptsApiService.handleApiError", () => {
  let service: PromptsApiService;
  let handleApiError: (typeof PromptsApiService.prototype)["handleApiError"];

  beforeEach(() => {
    service = new PromptsApiService({
      langwatchApiClient: mock(),
      logger: mock(),
    } as InternalConfig);
    // @ts-expect-error - handleApiError is private but we need to bind it to the service
    handleApiError = service.handleApiError.bind(service);
  });

  it("extracts string error", () => {
    expect(() => handleApiError("test operation", "simple error")).toThrow(PromptsApiError);

    let caught: unknown;
    try {
      handleApiError("test operation", "simple error");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).toBe("Failed to test operation: simple error");
    expect((caught as PromptsApiError).operation).toBe("test operation");
  });

  it("extracts nested error.error as string", () => {
    const error = { error: "nested error string" };

    let caught: unknown;
    try {
      handleApiError("test operation", error);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).toBe(
      "Failed to test operation: nested error string",
    );
  });

  it("extracts error.error.message", () => {
    const error = { error: { message: "nested error message" } };

    let caught: unknown;
    try {
      handleApiError("test operation", error);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).toBe(
      "Failed to test operation: nested error message",
    );
  });

  it("serializes error.error object when no message", () => {
    const error = { error: { code: 404, detail: "not found" } };

    let caught: unknown;
    try {
      handleApiError("test operation", error);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).toContain("404");
    expect((caught as PromptsApiError).message).toContain("not found");
  });

  it("extracts error.message when no error.error", () => {
    const error = { message: "direct error message" };

    let caught: unknown;
    try {
      handleApiError("test operation", error);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).toBe(
      "Failed to test operation: direct error message",
    );
  });

  it("uses unknown error when no extractable message", () => {
    const error = {};

    let caught: unknown;
    try {
      handleApiError("test operation", error);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).toBe(
      "Failed to test operation: Unknown error occurred",
    );
  });

  it("serializes Error objects properly (not [object Object])", () => {
    const error = { error: new Error("native error") };

    let caught: unknown;
    try {
      handleApiError("test operation", error);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).not.toContain("[object Object]");
    expect((caught as PromptsApiError).message).toContain("native error");
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

    let caught: unknown;
    try {
      handleApiError("test operation", error);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).not.toContain("[object Object]");
    // Should contain the properties thanks to Object.getOwnPropertyNames
    expect((caught as PromptsApiError).message).toContain("ERR_BAD_REQUEST");
    expect((caught as PromptsApiError).message).toContain("400");
  });

  it("handles complex nested objects without [object Object]", () => {
    const error = {
      error: {
        data: { user: "test", nested: { deep: "value" } },
        code: 500,
      },
    };

    let caught: unknown;
    try {
      handleApiError("test operation", error);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptsApiError);
    expect((caught as PromptsApiError).message).not.toContain("[object Object]");
    expect((caught as PromptsApiError).message).toContain("500");
  });
});
