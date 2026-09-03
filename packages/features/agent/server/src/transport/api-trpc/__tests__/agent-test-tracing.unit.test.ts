/**
 * @vitest-environment node
 *
 * Unit tests for auth credential sanitization in HTTP agent traces.
 * Verifies that sensitive auth data (tokens, keys, passwords) is redacted
 * before being included in trace metadata.
 */
import { describe, expect, it } from "vitest";
import { buildTraceTestContext, sanitizeHeadersForTrace } from "../agent-test-tracing";

describe("sanitizeHeadersForTrace()", () => {
  describe("when Authorization header contains a bearer token", () => {
    /** @scenario "Bearer token is redacted in trace" */
    it("redacts the token value", () => {
      const headers: Record<string, string> = {
        Authorization: "Bearer super-secret-token-123",
        "Content-Type": "application/json",
      };

      const sanitized = sanitizeHeadersForTrace({ headers });

      expect(sanitized.Authorization).toBe("Bearer [REDACTED]");
      expect(sanitized["Content-Type"]).toBe("application/json");
    });
  });

  describe("when Authorization header contains basic auth", () => {
    /** @scenario "Basic auth credentials are redacted in trace" */
    it("redacts the encoded credentials", () => {
      const encoded = Buffer.from("user:pass").toString("base64");
      const headers: Record<string, string> = {
        Authorization: `Basic ${encoded}`,
      };

      const sanitized = sanitizeHeadersForTrace({ headers });

      expect(sanitized.Authorization).toBe("Basic [REDACTED]");
    });
  });

  describe("when a custom auth header is present", () => {
    /** @scenario "API key is redacted in trace" */
    it("redacts the custom header value", () => {
      const headers: Record<string, string> = {
        "X-API-Key": "secret-key-456",
        "Content-Type": "application/json",
      };

      const sanitized = sanitizeHeadersForTrace({
        headers,
        customAuthHeaderName: "X-API-Key",
      });

      expect(sanitized["X-API-Key"]).toBe("[REDACTED]");
      expect(sanitized["Content-Type"]).toBe("application/json");
    });
  });

  describe("when Authorization header uses non-standard casing", () => {
    /** @scenario "Bearer token is redacted in trace" */
    it("redacts the token regardless of case", () => {
      const headers: Record<string, string> = {
        authorization: "Bearer case-insensitive-token",
        "Content-Type": "application/json",
      };

      const sanitized = sanitizeHeadersForTrace({ headers });

      expect(sanitized.authorization).toBe("Bearer [REDACTED]");
      expect(sanitized["Content-Type"]).toBe("application/json");
    });
  });

  describe("when custom auth header uses non-standard casing", () => {
    /** @scenario "API key is redacted in trace" */
    it("redacts the header regardless of case", () => {
      const headers: Record<string, string> = {
        "x-api-key": "secret-key-789",
      };

      const sanitized = sanitizeHeadersForTrace({
        headers,
        customAuthHeaderName: "X-API-Key",
      });

      expect(sanitized["x-api-key"]).toBe("[REDACTED]");
    });
  });

  describe("when no auth headers are present", () => {
    it("returns headers unchanged", () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const sanitized = sanitizeHeadersForTrace({ headers });

      expect(sanitized).toEqual(headers);
    });
  });

  // The Auth tab is not the only way a credential reaches a request. An author
  // who types one on the Headers tab has configured a credential too, and a
  // trace is a durable place for one to end up.
  describe("when a credential is typed as a plain header", () => {
    it.each([
      "X-API-Key",
      "X-Api-Key",
      "X-Auth-Token",
      "X-Authorization",
      "X-Auth",
      "X-Amz-Security-Token",
      "Cookie",
      "Set-Cookie",
      "Proxy-Authorization",
      "Db-Password",
      "X-Client-Secret",
    ])("redacts %s without being told it is auth", (name) => {
      const sanitized = sanitizeHeadersForTrace({
        headers: { [name]: "must-not-be-stored" },
      });

      expect(sanitized[name]).toBe("[REDACTED]");
    });

    it.each([
      ["X-Api-Version", "2026-08-01"],
      ["X-Idempotency-Key", "req-42"],
      ["X-Request-Id", "req-42"],
      ["WWW-Authenticate", 'Bearer realm="agents"'],
      ["X-RateLimit-Remaining", "42"],
    ])("keeps %s, which is not a credential", (name, value) => {
      const sanitized = sanitizeHeadersForTrace({ headers: { [name]: value } });

      expect(sanitized[name]).toBe(value);
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
