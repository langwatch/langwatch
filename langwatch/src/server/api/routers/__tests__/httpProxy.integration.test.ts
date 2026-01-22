/**
 * @vitest-environment node
 *
 * Integration tests for HTTP Proxy endpoint.
 * Tests HTTP request execution with auth, headers, and JSONPath extraction.
 *
 * Note: These tests mock ssrfSafeFetch to bypass SSRF validation since
 * SSRF protection has its own dedicated unit tests. This allows us to
 * focus on testing the HTTP proxy functionality.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Mock ssrfSafeFetch to bypass SSRF validation in tests
const mockSsrfSafeFetch = vi.fn();
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

describe("HTTP Proxy", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;

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
    mockSsrfSafeFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
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
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "success" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

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

      expect(mockSsrfSafeFetch).toHaveBeenCalled();
      const [, fetchOptions] = mockSsrfSafeFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(fetchOptions.headers).toBeDefined();
      expect(
        (fetchOptions.headers as Record<string, string>).Authorization,
      ).toBe("Bearer test-token-123");
    });
  });

  describe("when auth type is api_key", () => {
    it("adds custom header with api key value", async () => {
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "success" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

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

      expect(mockSsrfSafeFetch).toHaveBeenCalled();
      const [, fetchOptions] = mockSsrfSafeFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(
        (fetchOptions.headers as Record<string, string>)["X-API-Key"],
      ).toBe("secret-key-456");
    });
  });

  describe("when auth type is basic", () => {
    it("adds Authorization Basic header with base64 encoding", async () => {
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "success" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

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
      expect(mockSsrfSafeFetch).toHaveBeenCalled();
      const [, fetchOptions] = mockSsrfSafeFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(
        (fetchOptions.headers as Record<string, string>).Authorization,
      ).toBe(expectedAuth);
    });
  });

  describe("when custom headers provided", () => {
    it("adds all custom headers to request", async () => {
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "success" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

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

      expect(mockSsrfSafeFetch).toHaveBeenCalled();
      const [, fetchOptions] = mockSsrfSafeFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(
        (fetchOptions.headers as Record<string, string>)["X-Custom-1"],
      ).toBe("value1");
      expect(
        (fetchOptions.headers as Record<string, string>)["X-Custom-2"],
      ).toBe("value2");
    });
  });

  describe("when outputPath extracts value", () => {
    it("extracts string using JSONPath", async () => {
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              nested: {
                value: "extracted text",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

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
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: "value" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

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
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              obj: { key: "value" },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

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
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Resource not found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        }),
      );

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
      mockSsrfSafeFetch.mockRejectedValue(new Error("Network timeout"));

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
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "success" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

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
      mockSsrfSafeFetch.mockResolvedValue(
        new Response("plain text response", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );

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
