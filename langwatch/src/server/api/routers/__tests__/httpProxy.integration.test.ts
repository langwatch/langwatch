/**
 * @vitest-environment node
 *
 * Integration tests for HTTP Proxy endpoint.
 * Tests HTTP request execution with auth, headers, and JSONPath extraction.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("HTTP Proxy", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  const mockFetch = vi.fn();

  beforeAll(async () => {
    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  beforeEach(() => {
    mockFetch.mockReset();
    // Mock fetch per test
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when request body is invalid JSON", () => {
    it("returns error", async () => {
      const result = await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{invalid json",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid JSON in request body");
    });
  });

  describe("when auth type is bearer", () => {
    it("adds Authorization Bearer header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ result: "success" }),
      });

      await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        auth: {
          type: "bearer",
          token: "test-token-123",
        },
        body: "{}",
      });

      expect(mockFetch).toHaveBeenCalled();
      const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer test-token-123");
    });
  });

  describe("when auth type is api_key", () => {
    it("adds custom header with api key value", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ result: "success" }),
      });

      await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        auth: {
          type: "api_key",
          headerName: "X-API-Key",
          apiKeyValue: "secret-key-456",
        },
        body: "{}",
      });

      expect(mockFetch).toHaveBeenCalled();
      const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("X-API-Key")).toBe("secret-key-456");
    });
  });

  describe("when auth type is basic", () => {
    it("adds Authorization Basic header with base64 encoding", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ result: "success" }),
      });

      await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        auth: {
          type: "basic",
          username: "user",
          password: "pass",
        },
        body: "{}",
      });

      const expectedAuth = `Basic ${Buffer.from("user:pass").toString("base64")}`;
      expect(mockFetch).toHaveBeenCalled();
      const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("Authorization")).toBe(expectedAuth);
    });
  });

  describe("when custom headers provided", () => {
    it("adds all custom headers to request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ result: "success" }),
      });

      await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        headers: [
          { key: "X-Custom-1", value: "value1" },
          { key: "X-Custom-2", value: "value2" },
        ],
        body: "{}",
      });

      expect(mockFetch).toHaveBeenCalled();
      const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("X-Custom-1")).toBe("value1");
      expect(headers.get("X-Custom-2")).toBe("value2");
    });
  });

  describe("when outputPath extracts value", () => {
    it("extracts string using JSONPath", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({
          data: {
            nested: {
              value: "extracted text",
            },
          },
        }),
      });

      const result = await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
        outputPath: "$.data.nested.value",
      });

      expect(result.success).toBe(true);
      expect(result.extractedOutput).toBe("extracted text");
    });

    it("returns undefined when path not found", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ data: "value" }),
      });

      const result = await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
        outputPath: "$.nonexistent.path",
      });

      expect(result.success).toBe(true);
      expect(result.extractedOutput).toBeUndefined();
    });

    it("stringifies non-string values", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({
          data: {
            obj: { key: "value" },
          },
        }),
      });

      const result = await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
        outputPath: "$.data.obj",
      });

      expect(result.success).toBe(true);
      expect(result.extractedOutput).toBe('{"key":"value"}');
    });
  });

  describe("when request fails", () => {
    it("returns error for non-2xx HTTP status", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ error: "Resource not found" }),
      });

      const result = await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("HTTP 404: Not Found");
      expect(result.response).toEqual({ error: "Resource not found" });
    });

    it("returns error for network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const result = await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network timeout");
    });
  });

  describe("when request succeeds", () => {
    it("returns response data and metadata", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ result: "success" }),
      });

      const result = await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.response).toEqual({ result: "success" });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("handles text responses", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/plain"]]),
        text: async () => "plain text response",
      });

      const result = await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe("plain text response");
    });
  });
});
