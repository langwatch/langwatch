import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Response as UndiciResponse } from "undici";
import { GET } from "../route";
import { NextRequest } from "next/server";

// Mock the shared SSRF utility so tests are deterministic and don't hit the network.
vi.mock("../../../utils/ssrfProtection", () => ({
  ssrfSafeFetch: vi.fn(),
}));

import { ssrfSafeFetch } from "../../../utils/ssrfProtection";

function makeRequest(url: string | null): NextRequest {
  const rawUrl = url
    ? `http://localhost/api/image-proxy?url=${encodeURIComponent(url)}`
    : "http://localhost/api/image-proxy";
  return new NextRequest(rawUrl);
}

function makeImageResponse(contentType = "image/png", status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as unknown as UndiciResponse;
}

describe("GET /image-proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when url param is missing", () => {
    it("returns 400", async () => {
      const res = await GET(makeRequest(null));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Missing url");
    });
  });

  describe("when url is malformed or has a disallowed scheme", () => {
    it("returns 500 for a plain string (ssrfSafeFetch throws)", async () => {
      vi.mocked(ssrfSafeFetch).mockRejectedValueOnce(
        new Error("Invalid URL format"),
      );
      const res = await GET(makeRequest("not-a-url"));
      expect(res.status).toBe(500);
    });

    it("returns 500 for javascript: URL (ssrfSafeFetch throws)", async () => {
      vi.mocked(ssrfSafeFetch).mockRejectedValueOnce(
        new Error("Unsupported protocol: javascript:"),
      );
      const res = await GET(makeRequest("javascript:alert(1)"));
      expect(res.status).toBe(500);
    });

    it("returns 500 for ftp: URL (ssrfSafeFetch throws)", async () => {
      vi.mocked(ssrfSafeFetch).mockRejectedValueOnce(
        new Error("Unsupported protocol: ftp:"),
      );
      const res = await GET(makeRequest("ftp://example.com/image.png"));
      expect(res.status).toBe(500);
    });
  });

  describe("when ssrfSafeFetch blocks the URL", () => {
    it("returns 500 when ssrfSafeFetch throws", async () => {
      vi.mocked(ssrfSafeFetch).mockRejectedValueOnce(
        new Error("Access to private or localhost IP addresses is not allowed"),
      );
      const res = await GET(makeRequest("http://192.168.1.1/image.png"));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to fetch image");
    });
  });

  describe("when the remote server returns a non-OK status", () => {
    it("proxies the error status", async () => {
      vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
        makeImageResponse("image/png", 404),
      );
      const res = await GET(makeRequest("https://example.com/missing.png"));
      expect(res.status).toBe(404);
    });
  });

  describe("when the response is not an image", () => {
    it("returns 400 for text/html content type", async () => {
      vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
        makeImageResponse("text/html", 200),
      );
      const res = await GET(makeRequest("https://example.com/page.html"));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("URL does not point to an image");
    });
  });

  describe("when the URL points to a valid image", () => {
    it("proxies the image with correct headers for https URL", async () => {
      vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
        makeImageResponse("image/png"),
      );
      const res = await GET(
        makeRequest("https://example.com/image.png"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=31536000",
      );
    });

    it("proxies the image with correct headers for http URL", async () => {
      vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
        makeImageResponse("image/jpeg"),
      );
      const res = await GET(makeRequest("http://example.com/photo.jpg"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
    });

    it("passes the url to ssrfSafeFetch", async () => {
      vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
        makeImageResponse("image/gif"),
      );
      await GET(makeRequest("https://example.com/anim.gif"));
      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        "https://example.com/anim.gif",
      );
    });
  });
});
