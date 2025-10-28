import { describe, it, expect, beforeEach } from "vitest";
import { PromptsApiService, PromptsError } from "../prompts-api.service";
import { mock } from "vitest-mock-extended";
import type { InternalConfig } from "@/client-sdk/types";

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
    ).toThrow(PromptsError);

    try {
      handleApiError("test operation", "simple error");
    } catch (error) {
      expect(error).toBeInstanceOf(PromptsError);
      expect((error as PromptsError).message).toBe("Failed to test operation: simple error");
      expect((error as PromptsError).operation).toBe("test operation");
    }
  });

  it("extracts nested error.error as string", () => {
    const error = { error: "nested error string" };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsError);
      expect((e as PromptsError).message).toBe("Failed to test operation: nested error string");
    }
  });

  it("extracts error.error.message", () => {
    const error = { error: { message: "nested error message" } };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsError);
      expect((e as PromptsError).message).toBe("Failed to test operation: nested error message");
    }
  });

  it("serializes error.error object when no message", () => {
    const error = { error: { code: 404, detail: "not found" } };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsError);
      expect((e as PromptsError).message).toContain("404");
      expect((e as PromptsError).message).toContain("not found");
    }
  });

  it("extracts error.message when no error.error", () => {
    const error = { message: "direct error message" };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsError);
      expect((e as PromptsError).message).toBe("Failed to test operation: direct error message");
    }
  });

  it("uses unknown error when no extractable message", () => {
    const error = {};

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsError);
      expect((e as PromptsError).message).toBe("Failed to test operation: Unknown error occurred");
    }
  });

  it("serializes Error objects properly (not [object Object])", () => {
    const error = { error: new Error("native error") };

    try {
      handleApiError("test operation", error);
    } catch (e) {
      expect(e).toBeInstanceOf(PromptsError);
      expect((e as PromptsError).message).not.toContain("[object Object]");
      expect((e as PromptsError).message).toContain("native error");
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
      expect(e).toBeInstanceOf(PromptsError);
      expect((e as PromptsError).message).not.toContain("[object Object]");
      // Should contain the properties thanks to Object.getOwnPropertyNames
      expect((e as PromptsError).message).toContain("ERR_BAD_REQUEST");
      expect((e as PromptsError).message).toContain("400");
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
      expect(e).toBeInstanceOf(PromptsError);
      expect((e as PromptsError).message).not.toContain("[object Object]");
      expect((e as PromptsError).message).toContain("500");
    }
  });
});

