import { describe, it, expect } from "vitest";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
  formatApiErrorMessage,
} from "../format-api-error";

describe("formatApiErrorMessage", () => {
  describe("when given a null or undefined error", () => {
    it("returns a generic message with status when available", () => {
      expect(formatApiErrorMessage({ error: null, options: { status: 503 } })).toBe(
        "Request failed with status 503",
      );
    });

    it("returns a generic message without status", () => {
      expect(formatApiErrorMessage({ error: undefined })).toBe("Unknown error occurred");
    });
  });

  describe("when given a string error", () => {
    it("returns the string directly", () => {
      expect(formatApiErrorMessage({ error: "Something broke" })).toBe("Something broke");
    });

    it("annotates a generic string with the status", () => {
      expect(
        formatApiErrorMessage({ error: "Internal server error", options: { status: 500 } }),
      ).toBe("Internal server error (status 500)");
    });
  });

  describe("when given an Error instance", () => {
    it("returns the Error message", () => {
      const err = new Error("fetch failed: ECONNREFUSED");
      expect(formatApiErrorMessage({ error: err })).toBe("fetch failed: ECONNREFUSED");
    });
  });

  describe("when given an API error body", () => {
    it("prefers the descriptive message field", () => {
      const body = {
        error: "Conflict",
        message: "Prompt handle already exists for scope PROJECT",
      };
      expect(formatApiErrorMessage({ error: body })).toBe(
        "Conflict: Prompt handle already exists for scope PROJECT",
      );
    });

    it("returns just the message when error and message are identical", () => {
      const body = {
        error: "NotFoundError",
        message: "NotFoundError",
      };
      expect(formatApiErrorMessage({ error: body })).toBe("NotFoundError");
    });

    it("falls back to error when message is generic", () => {
      const body = {
        error: "TagValidationError",
        message: "Internal server error",
      };
      expect(formatApiErrorMessage({ error: body })).toBe("TagValidationError");
    });

    it("does not collapse to 'Internal server error' when other fields exist", () => {
      const body = {
        error: "Internal server error",
        message: "connection refused",
      };
      expect(formatApiErrorMessage({ error: body })).toBe("connection refused");
    });

    it("serialises the raw body when no meaningful fields are present", () => {
      const body = { code: "UNEXPECTED", details: { traceId: "abc" } };
      const formatted = formatApiErrorMessage({ error: body, options: { status: 500 } });
      expect(formatted).toContain("UNEXPECTED");
      expect(formatted).toContain("traceId");
      expect(formatted).toContain("500");
    });

    it("handles nested error objects (tRPC-style)", () => {
      const body = {
        error: {
          message: "validation failed: name is required",
          code: "BAD_REQUEST",
        },
      };
      expect(formatApiErrorMessage({ error: body })).toBe(
        "validation failed: name is required",
      );
    });

    it("ignores fields with empty strings", () => {
      const body = { error: "", message: "the real message" };
      expect(formatApiErrorMessage({ error: body })).toBe("the real message");
    });
  });

  it("never swallows the body when only generic labels are present", () => {
    const body = { error: "Internal server error", message: "Internal server error" };
    const formatted = formatApiErrorMessage({ error: body, options: { status: 500 } });
    expect(formatted.toLowerCase()).toContain("server returned");
    expect(formatted).toContain("500");
  });
});

describe("formatApiErrorForOperation", () => {
  it("prepends the operation context", () => {
    const body = { error: "NotFoundError", message: "Prompt not found" };
    expect(formatApiErrorForOperation({ operation: "fetch prompt", error: body })).toBe(
      "Failed to fetch prompt: NotFoundError: Prompt not found",
    );
  });
});

describe("extractStatusFromResponse", () => {
  it("pulls status from a direct `status` property", () => {
    expect(extractStatusFromResponse({ status: 404 })).toBe(404);
  });

  it("pulls status from a nested response object", () => {
    expect(extractStatusFromResponse({ response: { status: 409 } })).toBe(409);
  });

  it("pulls status from a `statusCode` alias", () => {
    expect(extractStatusFromResponse({ statusCode: 422 })).toBe(422);
  });

  it("returns undefined when no status is present", () => {
    expect(extractStatusFromResponse({ foo: "bar" })).toBeUndefined();
    expect(extractStatusFromResponse(null)).toBeUndefined();
  });
});
