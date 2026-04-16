import { describe, it, expect } from "vitest";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
  formatApiErrorMessage,
} from "../format-api-error";

describe("formatApiErrorMessage", () => {
  describe("when given a null or undefined error", () => {
    it("returns a generic message with status when available", () => {
      expect(formatApiErrorMessage(null, { status: 503 })).toBe(
        "Request failed with status 503",
      );
    });

    it("returns a generic message without status", () => {
      expect(formatApiErrorMessage(undefined)).toBe("Unknown error occurred");
    });
  });

  describe("when given a string error", () => {
    it("returns the string directly", () => {
      expect(formatApiErrorMessage("Something broke")).toBe("Something broke");
    });

    it("annotates a generic string with the status", () => {
      expect(
        formatApiErrorMessage("Internal server error", { status: 500 }),
      ).toBe("Internal server error (status 500)");
    });
  });

  describe("when given an Error instance", () => {
    it("returns the Error message", () => {
      const err = new Error("fetch failed: ECONNREFUSED");
      expect(formatApiErrorMessage(err)).toBe("fetch failed: ECONNREFUSED");
    });
  });

  describe("when given an API error body", () => {
    it("prefers the descriptive message field", () => {
      const body = {
        error: "Conflict",
        message: "Prompt handle already exists for scope PROJECT",
      };
      expect(formatApiErrorMessage(body)).toBe(
        "Conflict: Prompt handle already exists for scope PROJECT",
      );
    });

    it("returns just the message when error and message are identical", () => {
      const body = {
        error: "NotFoundError",
        message: "NotFoundError",
      };
      expect(formatApiErrorMessage(body)).toBe("NotFoundError");
    });

    it("falls back to error when message is generic", () => {
      const body = {
        error: "TagValidationError",
        message: "Internal server error",
      };
      expect(formatApiErrorMessage(body)).toBe("TagValidationError");
    });

    it("does not collapse to 'Internal server error' when other fields exist", () => {
      const body = {
        error: "Internal server error",
        message: "connection refused",
      };
      expect(formatApiErrorMessage(body)).toBe("connection refused");
    });

    it("serialises the raw body when no meaningful fields are present", () => {
      const body = { code: "UNEXPECTED", details: { traceId: "abc" } };
      const formatted = formatApiErrorMessage(body, { status: 500 });
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
      expect(formatApiErrorMessage(body)).toBe(
        "validation failed: name is required",
      );
    });

    it("ignores fields with empty strings", () => {
      const body = { error: "", message: "the real message" };
      expect(formatApiErrorMessage(body)).toBe("the real message");
    });
  });

  it("never swallows the body when only generic labels are present", () => {
    const body = { error: "Internal server error", message: "Internal server error" };
    const formatted = formatApiErrorMessage(body, { status: 500 });
    expect(formatted.toLowerCase()).toContain("server returned");
    expect(formatted).toContain("500");
  });
});

describe("formatApiErrorForOperation", () => {
  it("prepends the operation context", () => {
    const body = { error: "NotFoundError", message: "Prompt not found" };
    expect(formatApiErrorForOperation("fetch prompt", body)).toBe(
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
