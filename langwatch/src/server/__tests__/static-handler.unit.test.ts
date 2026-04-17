import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AddressInfo } from "net";

import { serveStaticOrFallback } from "../static-handler";

function rawRequest(
  port: number,
  rawPath: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: "GET", path: rawPath },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("serveStaticOrFallback", () => {
  let clientDistDir: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    clientDistDir = mkdtempSync(join(tmpdir(), "static-handler-test-"));
    mkdirSync(join(clientDistDir, "assets"), { recursive: true });
    writeFileSync(
      join(clientDistDir, "assets", "index-abc123.js"),
      "console.log('hello from index-abc123');\n"
    );
    writeFileSync(
      join(clientDistDir, "assets", "main-deadbeef.css"),
      "body { color: red; }\n"
    );
    writeFileSync(
      join(clientDistDir, "index.html"),
      "<!doctype html><html><body><div id=root></div></body></html>"
    );

    server = createServer((req, res) => {
      const pathname = (req.url ?? "/").split("?")[0] ?? "/";
      const handled = serveStaticOrFallback({ res, pathname, clientDistDir });
      if (!handled) {
        res.statusCode = 404;
        res.end("Not Found");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(clientDistDir, { recursive: true, force: true });
  });

  describe("when an existing /assets/ file is requested", () => {
    it("returns 200 with correct MIME and immutable cache header", async () => {
      const res = await fetch(`${baseUrl}/assets/index-abc123.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/javascript");
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable"
      );
      expect(await res.text()).toContain("hello from index-abc123");
    });

    it("serves CSS with correct MIME", async () => {
      const res = await fetch(`${baseUrl}/assets/main-deadbeef.css`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/css");
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable"
      );
    });
  });

  describe("when a missing /assets/ file is requested", () => {
    it("returns 404, not the SPA index.html", async () => {
      const res = await fetch(`${baseUrl}/assets/does-not-exist-xyz.js`);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain("<!doctype html>");
      expect(body).not.toContain("<div id=root>");
    });

    it("sets a no-store Cache-Control so CDNs do not poison the URL", async () => {
      const res = await fetch(`${baseUrl}/assets/missing-chunk.js`);
      expect(res.status).toBe(404);
      const cacheControl = res.headers.get("cache-control") ?? "";
      expect(cacheControl).toMatch(/no-store/);
      expect(cacheControl).not.toMatch(/immutable/);
    });

    it("returns 404 even when Accept includes text/html", async () => {
      const res = await fetch(`${baseUrl}/assets/foo-stale.js`, {
        headers: { Accept: "text/html,application/xhtml+xml,*/*" },
      });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("<!doctype html>");
    });
  });

  describe("when a non-asset route is requested", () => {
    it("returns the SPA index.html as text/html", async () => {
      const res = await fetch(`${baseUrl}/projects/foo/traces`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html");
      expect(await res.text()).toContain("<div id=root>");
    });

    it("returns 200 + index.html for the root path", async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html");
    });
  });

  describe("when an asset path attempts traversal", () => {
    it("returns 400 before touching the filesystem", async () => {
      const port = (server.address() as AddressInfo).port;
      const res = await rawRequest(port, "/assets/../../etc/passwd");
      expect(res.status).toBe(400);
    });
  });
});
