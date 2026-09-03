import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiRawRequestSurfacePort } from "../../api-http.listener";
import {
  ApiStaticSurface,
  CompositeApiRawSurface,
  normalizePathname,
  pathIsClaimedByTheApi,
  resolveClientDistDir,
  tryCreateApiStaticSurface,
} from "../app-static.surface";

describe("given the API process serves the browser bundle", () => {
  describe("when a path belongs to the API", () => {
    it("refuses every /api path, including the health probe", () => {
      for (const pathname of [
        "/api",
        "/api/health",
        "/api/trpc/project.getAll",
        "/api/sse/presence.onPresenceUpdate",
        "/api/collector",
      ]) {
        expect(pathIsClaimedByTheApi(pathname)).toBe(true);
      }
    });

    it("refuses the metrics scrape", () => {
      expect(pathIsClaimedByTheApi("/metrics")).toBe(true);
    });

    it("refuses the OTLP paths a misconfigured exporter posts to", () => {
      // The SPA fallback would answer these with the HTML shell and a 200,
      // which an exporter reads as success before dropping the batch.
      expect(pathIsClaimedByTheApi("/v1/traces")).toBe(true);
      expect(pathIsClaimedByTheApi("/v1/logs")).toBe(true);
    });

    it("refuses the root discovery documents, trailing slash included", () => {
      expect(pathIsClaimedByTheApi("/.well-known/openapi")).toBe(true);
      expect(pathIsClaimedByTheApi("/llms.txt")).toBe(true);
      expect(pathIsClaimedByTheApi("/llms.txt/")).toBe(true);
    });
  });

  describe("when a path belongs to the browser", () => {
    it("claims the SPA routes and the built assets", () => {
      for (const pathname of [
        "/",
        "/authorize",
        "/my-project/traces",
        "/assets/index-abc123.js",
        "/favicon.ico",
        "/images/logo.svg",
      ]) {
        expect(pathIsClaimedByTheApi(pathname)).toBe(false);
      }
    });
  });

  describe("when the request URL carries a query or repeated slashes", () => {
    it("reduces it to the pathname the fallback guard accepts", () => {
      expect(normalizePathname("/authorize?next=%2Fhome")).toBe("/authorize");
      expect(normalizePathname("//authorize")).toBe("/authorize");
      expect(normalizePathname("/")).toBe("/");
    });
  });
});

describe("given a deployment stages the bundle somewhere", () => {
  let clientDistDir: string;

  beforeEach(() => {
    clientDistDir = mkdtempSync(join(tmpdir(), "app-static-surface-"));
  });

  afterEach(() => {
    rmSync(clientDistDir, { recursive: true, force: true });
  });

  describe("when LANGWATCH_UI_DIST_DIR names it", () => {
    /** @scenario "The production API serves the built UI artifact" */
    it("resolves the configured directory", () => {
      expect(resolveClientDistDir({ LANGWATCH_UI_DIST_DIR: clientDistDir })).toBe(
        clientDistDir,
      );
    });
  });

  describe("when nothing names it", () => {
    it("resolves the apps/ui build output beside this app", () => {
      expect(resolveClientDistDir({})).toMatch(/apps[/\\]ui[/\\]dist[/\\]client$/);
    });
  });

  describe("when the bundle is absent", () => {
    it("reports the absence by name and composes no surface", () => {
      const reported: { message: string; clientDistDir: string }[] = [];

      const surface = tryCreateApiStaticSurface({
        environment: { LANGWATCH_UI_DIST_DIR: clientDistDir },
        report: (message, context) => reported.push({ message, ...context }),
      });

      expect(surface).toBeUndefined();
      expect(reported).toHaveLength(1);
      expect(reported[0]?.message).toContain("LANGWATCH_UI_DIST_DIR");
      expect(reported[0]?.clientDistDir).toBe(clientDistDir);
    });
  });

  describe("when the bundle is present", () => {
    it("composes a surface that serves the shell and reports nothing", () => {
      mkdirSync(join(clientDistDir, "assets"), { recursive: true });
      writeFileSync(join(clientDistDir, "index.html"), "<!doctype html><html></html>");
      const reported: string[] = [];

      const surface = tryCreateApiStaticSurface({
        environment: {
          LANGWATCH_UI_DIST_DIR: clientDistDir,
          BASE_HOST: "https://app.example.com",
          NODE_ENV: "test",
        },
        report: (message) => reported.push(message),
      });

      expect(reported).toEqual([]);
      expect(surface).toBeInstanceOf(ApiStaticSurface);
      expect(surface?.handles("/authorize")).toBe(true);
      expect(surface?.handles("/api/health")).toBe(false);
    });
  });
});

class StubSurface extends ApiRawRequestSurfacePort {
  readonly served: string[] = [];

  constructor(
    private readonly claimed: (pathname: string) => boolean,
    private readonly name: string,
  ) {
    super();
  }

  handles(pathname: string): boolean {
    return this.claimed(pathname);
  }

  handle(request: IncomingMessage, _response: ServerResponse): void {
    this.served.push(`${this.name}:${request.url ?? ""}`);
  }
}

function stubResponse(): ServerResponse & { statusCode: number; ended: string | undefined } {
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    ended: undefined,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(body?: string) {
      (this as { ended: string | undefined }).ended = body;
    },
  } as unknown as ServerResponse & { statusCode: number; ended: string | undefined };
}

describe("given the listener offers one raw-surface hook", () => {
  describe("when only one surface is present", () => {
    it("hands back that surface rather than a wrapper", () => {
      const only = new StubSurface(() => true, "only");
      expect(CompositeApiRawSurface.of([undefined, only])).toBe(only);
    });
  });

  describe("when no surface is present", () => {
    it("hands back nothing so the listener stays on its plain path", () => {
      expect(CompositeApiRawSurface.of([undefined, undefined])).toBeUndefined();
    });
  });

  describe("when a specific surface and the fallback are both present", () => {
    it("asks them in order, so the fallback never takes a claimed path", () => {
      const mcp = new StubSurface((pathname) => pathname.startsWith("/mcp"), "mcp");
      const fallback = new StubSurface(() => true, "fallback");
      const composite = CompositeApiRawSurface.of([mcp, fallback])!;

      composite.handle({ url: "/mcp/session" } as IncomingMessage, stubResponse());
      composite.handle({ url: "/authorize" } as IncomingMessage, stubResponse());

      expect(mcp.served).toEqual(["mcp:/mcp/session"]);
      expect(fallback.served).toEqual(["fallback:/authorize"]);
    });

    it("claims a path when any surface does", () => {
      const mcp = new StubSurface((pathname) => pathname.startsWith("/mcp"), "mcp");
      const spa = new StubSurface((pathname) => !pathname.startsWith("/api/"), "spa");
      const composite = CompositeApiRawSurface.of([mcp, spa])!;

      expect(composite.handles("/mcp/session")).toBe(true);
      expect(composite.handles("/authorize")).toBe(true);
      expect(composite.handles("/api/health")).toBe(false);
    });
  });
});
