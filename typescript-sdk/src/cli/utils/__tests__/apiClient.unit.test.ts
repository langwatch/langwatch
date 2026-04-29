import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest } from "../apiClient";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

describe("apiRequest()", () => {
  const apiKey = "sk-lw-test-key";
  const endpoint = "https://app.langwatch.ai";
  let captured: CapturedCall;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captured = { url: "", init: {} };
    fetchMock = vi.fn(
      async (url: string, init: RequestInit): Promise<Response> => {
        captured = { url, init };
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function getHeader(name: string): string | undefined {
    const headers = captured.init.headers as Record<string, string> | undefined;
    if (!headers) return undefined;
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lower) return value;
    }
    return undefined;
  }

  describe("when sending any request", () => {
    it("sets User-Agent: langwatch-cli/<version>", async () => {
      await apiRequest({ method: "GET", path: "/api/monitors", apiKey, endpoint });

      const ua = getHeader("User-Agent");
      expect(ua).toBeDefined();
      expect(ua).toMatch(/^langwatch-cli\//);
    });

    it("sets Authorization for sk-lw-* keys via buildAuthHeaders", async () => {
      await apiRequest({ method: "GET", path: "/api/monitors", apiKey, endpoint });

      // buildAuthHeaders lowercases the auth header key; what matters is that
      // the Bearer token reaches the server.
      const auth = getHeader("authorization");
      expect(auth).toBe(`Bearer ${apiKey}`);
    });

    it("prepends the endpoint to the path", async () => {
      await apiRequest({ method: "GET", path: "/api/monitors", apiKey, endpoint });
      expect(captured.url).toBe("https://app.langwatch.ai/api/monitors");
    });
  });

  describe("when called without a body", () => {
    it("does not set Content-Type", async () => {
      await apiRequest({ method: "GET", path: "/api/monitors", apiKey, endpoint });
      expect(getHeader("Content-Type")).toBeUndefined();
    });

    it("does not include a body in the fetch init", async () => {
      await apiRequest({ method: "GET", path: "/api/monitors", apiKey, endpoint });
      expect(captured.init.body).toBeUndefined();
    });
  });

  describe("when called with a body", () => {
    it("sets Content-Type: application/json and JSON-stringifies the body", async () => {
      await apiRequest({
        method: "POST",
        path: "/api/monitors",
        apiKey,
        endpoint,
        body: { name: "x" },
      });

      expect(getHeader("Content-Type")).toBe("application/json");
      expect(captured.init.body).toBe(JSON.stringify({ name: "x" }));
    });
  });

  describe("when the response is 204 No Content", () => {
    it("returns null", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const result = await apiRequest({
        method: "DELETE",
        path: "/api/monitors/abc",
        apiKey,
        endpoint,
      });
      expect(result).toBeNull();
    });
  });

  describe("when the response is empty (content-length: 0)", () => {
    it("returns null without parsing JSON", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: { "content-length": "0" },
        }),
      );
      const result = await apiRequest({
        method: "GET",
        path: "/api/monitors",
        apiKey,
        endpoint,
      });
      expect(result).toBeNull();
    });
  });

  describe("when the response is non-2xx", () => {
    it("throws an Error formatted via formatFetchError", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Not allowed" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      );
      await expect(
        apiRequest({ method: "GET", path: "/api/monitors", apiKey, endpoint }),
      ).rejects.toThrow(/Not allowed/);
    });

    it("surfaces the status code when the body has no useful message", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("", { status: 500 }),
      );
      await expect(
        apiRequest({ method: "GET", path: "/api/monitors", apiKey, endpoint }),
      ).rejects.toThrow(/500/);
    });

    it("attaches the response status to the thrown error", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "nope" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );
      try {
        await apiRequest({
          method: "GET",
          path: "/api/monitors",
          apiKey,
          endpoint,
        });
        throw new Error("expected apiRequest to throw");
      } catch (err) {
        expect((err as { status?: number }).status).toBe(401);
      }
    });
  });
});
