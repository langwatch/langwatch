import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ApiHttpListener, ApiRawRequestSurfacePort } from "../api-http.listener";

class PathClaimingSurface extends ApiRawRequestSurfacePort {
  readonly seen: string[] = [];

  constructor(private readonly prefix: string) {
    super();
  }

  handles(pathname: string): boolean {
    return pathname === this.prefix || pathname.startsWith(`${this.prefix}/`);
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    this.seen.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("raw");
  }
}

describe("given a listener with a raw surface in front of the application", () => {
  describe("when a request names a path the surface claims", () => {
    it("serves it from the surface and never reaches the application", async () => {
      const surface = new PathClaimingSurface("/mcp");
      const application = new Hono().all("*", (context) => context.text("hono"));
      const listener = ApiHttpListener.create({
        application,
        host: "127.0.0.1",
        port: 0,
        drainGraceMs: 1,
        rawSurface: surface,
      });
      const address = await listener.start();

      const response = await fetch(`http://127.0.0.1:${address.port}/mcp?session=1`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("raw");
      expect(surface.seen).toEqual(["/mcp?session=1"]);

      await listener.close();
    });
  });

  describe("when a request names any other path", () => {
    it("reaches the application untouched", async () => {
      const surface = new PathClaimingSurface("/mcp");
      const application = new Hono().get("/ready", (context) => context.text("ready"));
      const listener = ApiHttpListener.create({
        application,
        host: "127.0.0.1",
        port: 0,
        drainGraceMs: 1,
        rawSurface: surface,
      });
      const address = await listener.start();

      const response = await fetch(`http://127.0.0.1:${address.port}/ready`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("ready");
      expect(surface.seen).toEqual([]);

      await listener.close();
    });
  });

  describe("when a caller sends a Host header naming a claimed path", () => {
    it("routes on the request's own path rather than the header", async () => {
      const surface = new PathClaimingSurface("/mcp");
      const application = new Hono().get("/ready", (context) => context.text("ready"));
      const listener = ApiHttpListener.create({
        application,
        host: "127.0.0.1",
        port: 0,
        drainGraceMs: 1,
        rawSurface: surface,
      });
      const address = await listener.start();

      const response = await fetch(`http://127.0.0.1:${address.port}/ready`, {
        headers: { host: "evil.example/mcp" },
      });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("ready");
      expect(surface.seen).toEqual([]);

      await listener.close();
    });
  });
});
