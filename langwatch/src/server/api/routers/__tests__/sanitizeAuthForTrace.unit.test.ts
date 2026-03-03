/**
 * @vitest-environment node
 *
 * Unit tests for auth credential sanitization in HTTP agent traces.
 * Verifies that sensitive auth data (tokens, keys, passwords) is redacted
 * before being included in trace metadata.
 */
import { describe, expect, it } from "vitest";
import {
  sanitizeHeadersForTrace,
  buildTraceTestContext,
} from "../httpProxyTracing";

describe("sanitizeHeadersForTrace()", () => {
  describe("when Authorization header contains a bearer token", () => {
    it("redacts the token value", () => {
      const headers: Record<string, string> = {
        Authorization: "Bearer super-secret-token-123",
        "Content-Type": "application/json",
      };

      const sanitized = sanitizeHeadersForTrace(headers);

      expect(sanitized.Authorization).toBe("Bearer [REDACTED]");
      expect(sanitized["Content-Type"]).toBe("application/json");
    });
  });

  describe("when Authorization header contains basic auth", () => {
    it("redacts the encoded credentials", () => {
      const encoded = Buffer.from("user:pass").toString("base64");
      const headers: Record<string, string> = {
        Authorization: `Basic ${encoded}`,
      };

      const sanitized = sanitizeHeadersForTrace(headers);

      expect(sanitized.Authorization).toBe("Basic [REDACTED]");
    });
  });

  describe("when a custom auth header is present", () => {
    it("redacts the custom header value", () => {
      const headers: Record<string, string> = {
        "X-API-Key": "secret-key-456",
        "Content-Type": "application/json",
      };

      const sanitized = sanitizeHeadersForTrace(headers, "X-API-Key");

      expect(sanitized["X-API-Key"]).toBe("[REDACTED]");
      expect(sanitized["Content-Type"]).toBe("application/json");
    });
  });

  describe("when Authorization header uses non-standard casing", () => {
    it("redacts the token regardless of case", () => {
      const headers: Record<string, string> = {
        authorization: "Bearer case-insensitive-token",
        "Content-Type": "application/json",
      };

      const sanitized = sanitizeHeadersForTrace(headers);

      expect(sanitized.authorization).toBe("Bearer [REDACTED]");
      expect(sanitized["Content-Type"]).toBe("application/json");
    });
  });

  describe("when custom auth header uses non-standard casing", () => {
    it("redacts the header regardless of case", () => {
      const headers: Record<string, string> = {
        "x-api-key": "secret-key-789",
      };

      const sanitized = sanitizeHeadersForTrace(headers, "X-API-Key");

      expect(sanitized["x-api-key"]).toBe("[REDACTED]");
    });
  });

  describe("when no auth headers are present", () => {
    it("returns headers unchanged", () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const sanitized = sanitizeHeadersForTrace(headers);

      expect(sanitized).toEqual(headers);
    });
  });
});

describe("buildTraceTestContext()", () => {
  describe("when auth is bearer type", () => {
    it("sets has_auth to true", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
        auth: { type: "bearer", token: "secret-token" },
      });

      expect(context.has_auth).toBe(true);
    });

    it("does not include the token value", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
        auth: { type: "bearer", token: "secret-token" },
      });

      expect(JSON.stringify(context)).not.toContain("secret-token");
    });
  });

  describe("when auth is api_key type", () => {
    it("sets has_auth to true", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
        auth: {
          type: "api_key",
          headerName: "X-API-Key",
          apiKeyValue: "secret-key",
        },
      });

      expect(context.has_auth).toBe(true);
    });

    it("does not include the api key value", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
        auth: {
          type: "api_key",
          headerName: "X-API-Key",
          apiKeyValue: "secret-key",
        },
      });

      expect(JSON.stringify(context)).not.toContain("secret-key");
    });
  });

  describe("when auth is basic type", () => {
    it("sets has_auth to true", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
        auth: { type: "basic", username: "admin", password: "s3cret" },
      });

      expect(context.has_auth).toBe(true);
    });

    it("does not include username or password", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
        auth: { type: "basic", username: "admin", password: "s3cret" },
      });

      const serialized = JSON.stringify(context);
      expect(serialized).not.toContain("admin");
      expect(serialized).not.toContain("s3cret");
    });
  });

  describe("when auth is none", () => {
    it("sets has_auth to false", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "GET",
        auth: { type: "none" },
      });

      expect(context.has_auth).toBe(false);
    });
  });

  describe("when auth is undefined", () => {
    it("sets has_auth to false", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "GET",
      });

      expect(context.has_auth).toBe(false);
    });
  });

  describe("when output path is configured", () => {
    it("includes the output path", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
        outputPath: "$.data.result",
      });

      expect(context.output_path).toBe("$.data.result");
    });
  });

  describe("when output path is not configured", () => {
    it("omits the output path", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
      });

      expect(context.output_path).toBeUndefined();
    });
  });

  describe("when called with URL and method", () => {
    it("includes the request URL and method", () => {
      const context = buildTraceTestContext({
        url: "https://api.example.com/test",
        method: "POST",
      });

      expect(context.url).toBe("https://api.example.com/test");
      expect(context.method).toBe("POST");
    });
  });
});
