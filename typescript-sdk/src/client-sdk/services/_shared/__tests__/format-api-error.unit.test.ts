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

    it("appends cause.code for node fetch transport failures", () => {
      // Node's fetch wraps transport errors as `TypeError: fetch failed` with
      // the real reason (ECONNREFUSED, ENOTFOUND, etc.) on `.cause`. Without
      // this, users see a useless "fetch failed" with no clue whether DNS,
      // the port, or the server is the problem.
      const cause = Object.assign(new Error(""), { code: "ECONNREFUSED" });
      const err = Object.assign(new TypeError("fetch failed"), { cause });
      expect(formatApiErrorMessage({ error: err })).toBe(
        "fetch failed (ECONNREFUSED)",
      );
    });

    it("includes cause.code and cause.message together when both informative", () => {
      const cause = Object.assign(
        new Error("getaddrinfo ENOTFOUND host.invalid"),
        { code: "ENOTFOUND" },
      );
      const err = Object.assign(new TypeError("fetch failed"), { cause });
      expect(formatApiErrorMessage({ error: err })).toBe(
        "fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND host.invalid)",
      );
    });

    it("drops cause detail when it duplicates the outer message", () => {
      const cause = Object.assign(new Error("fetch failed"), {});
      const err = Object.assign(new TypeError("fetch failed"), { cause });
      expect(formatApiErrorMessage({ error: err })).toBe("fetch failed");
    });

    it("handles plain-object causes without crashing", () => {
      const err = Object.assign(new Error("request timed out"), {
        cause: { code: "ETIMEDOUT", message: "timeout after 30s" },
      });
      expect(formatApiErrorMessage({ error: err })).toBe(
        "request timed out (ETIMEDOUT: timeout after 30s)",
      );
    });

    it("adds an LANGWATCH_ENDPOINT hint when the URL has no scheme", () => {
      // Node fetch: if LANGWATCH_ENDPOINT is `localhost:5570` (no scheme),
      // node throws `TypeError: fetch failed` with `cause.message =
      // "unknown scheme"`. "unknown scheme" is unactionable to an end user.
      const cause = Object.assign(new Error("unknown scheme"), {});
      const err = Object.assign(new TypeError("fetch failed"), { cause });
      const out = formatApiErrorMessage({ error: err });
      expect(out).toContain("unknown scheme");
      expect(out).toContain("LANGWATCH_ENDPOINT");
      expect(out).toContain("http://");
    });

    it("adds an LANGWATCH_ENDPOINT hint when the URL is unparseable", () => {
      // `fetch("not a url at all!")` throws
      // `TypeError: Failed to parse URL from ...` with `code = ERR_INVALID_URL`.
      const cause = Object.assign(new Error("Invalid URL"), {
        code: "ERR_INVALID_URL",
      });
      const err = Object.assign(
        new TypeError("Failed to parse URL from not a url/api/prompts"),
        { cause },
      );
      const out = formatApiErrorMessage({ error: err });
      expect(out).toContain("LANGWATCH_ENDPOINT");
      expect(out).toContain("http://");
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

    it("formats top-level ZodError issues into a readable list", () => {
      const body = {
        name: "ZodError",
        issues: [
          { path: ["format"], message: "Invalid enum value" },
          { path: ["limit"], message: "Must be positive" },
        ],
      };
      expect(formatApiErrorMessage({ error: body })).toBe(
        "Validation failed: format — Invalid enum value; limit — Must be positive",
      );
    });

    it("formats ZodError envelopes wrapped in { success: false, error: {...} }", () => {
      // Real-world shape from `/api/traces/search` on bad input.
      const body = {
        success: false,
        error: {
          name: "ZodError",
          issues: [
            {
              received: "table",
              code: "invalid_enum_value",
              options: ["digest", "json"],
              path: ["format"],
              message:
                "Invalid enum value. Expected 'digest' | 'json', received 'table'",
            },
          ],
        },
      };
      expect(formatApiErrorMessage({ error: body })).toBe(
        "Validation failed: format — Invalid enum value. Expected 'digest' | 'json', received 'table'",
      );
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
