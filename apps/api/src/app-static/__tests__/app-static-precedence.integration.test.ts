import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiHttpListener } from "../../api-http.listener.ts";
import { mountedPathsOfRestFamilies, tryCreateApiStaticSurface } from "../app-static.surface.ts";

/**
 * The production listener's route precedence, end to end: the API families answer every
 * address they declare, and the browser bundle answers what is left.
 *
 * The order is the whole point. The SPA fallback is served from the listener's raw hook,
 * ahead of the Hono application, so it has to decline a claimed path rather than reach it —
 * a fallback that answered `/api/prompts` would turn a 401 into an HTML shell with a 200,
 * and a fallback that answered `/mcp` would take the hosted Model Context Protocol endpoint
 * off the air.
 */
describe("given the api process serves both the REST families and the browser bundle", () => {
  let clientDistDir: string;
  let listener: ApiHttpListener | undefined;
  let origin: string;

  /** The families this process mounts, shaped like the real ones: absolute paths, one
   * per-family middleware registration, and root addresses outside `/api`. */
  function restFamilies(): Hono[] {
    const prompts = new Hono();
    // What `createRestRuntime` registers per family before any route.
    prompts.use("*", async (_context, next) => next());
    prompts.all("/api/prompts", (context) => context.json({ error: "unauthorized" }, 401));
    prompts.all("/api/prompts/:id", (context) => context.json({ id: context.req.param("id") }));

    // modules/hosted-mcp declares these at the root, not under /api.
    const hostedMcp = new Hono();
    for (const path of [
      "/mcp",
      "/sse",
      "/messages",
      "/oauth/token",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      hostedMcp.all(path, (context) => context.text(`mcp ${path}`));
    }

    return [prompts, hostedMcp];
  }

  beforeEach(async () => {
    clientDistDir = mkdtempSync(join(tmpdir(), "app-static-precedence-"));
    mkdirSync(join(clientDistDir, "assets"), { recursive: true });
    writeFileSync(
      join(clientDistDir, "index.html"),
      "<!doctype html><html><head><title>LangWatch</title></head><body>browser shell</body></html>",
    );
    writeFileSync(join(clientDistDir, "assets", "index-abc123.js"), "export const bundle = 1;\n");

    const families = restFamilies();
    const application = new Hono();
    for (const family of families) application.route("/", family);

    const staticSurface = tryCreateApiStaticSurface({
      environment: {
        LANGWATCH_UI_DIST_DIR: clientDistDir,
        BASE_HOST: "https://app.example.com",
        NODE_ENV: "test",
      },
      report: () => void 0,
      mountedPaths: mountedPathsOfRestFamilies(families),
    });
    expect(staticSurface).toBeDefined();

    listener = ApiHttpListener.create({
      application,
      host: "127.0.0.1",
      port: 0,
      drainGraceMs: 1,
      ...(staticSurface ? { staticSurface } : {}),
    });
    const address = await listener.start();
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await listener?.close();
    listener = undefined;
    rmSync(clientDistDir, { recursive: true, force: true });
  });

  describe("when a browser asks for a route the bundle owns", () => {
    /** @scenario "Unknown non-asset route falls back to index.html for SPA routing" */
    it("answers the shell at the root and at any deep link", async () => {
      for (const path of ["/", "/authorize", "/my-project/traces"]) {
        const response = await fetch(`${origin}${path}`);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        await expect(response.text()).resolves.toContain("browser shell");
      }
    });

    it("answers the built asset itself, not the shell", async () => {
      const response = await fetch(`${origin}/assets/index-abc123.js`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("export const bundle");
    });

    it("carries the security headers on the document it serves", async () => {
      const response = await fetch(`${origin}/`);

      // Enforced in production and reported in development (the split is
      // app-static-security-headers.unit.test.ts's); either way the policy
      // rides on the document this surface serves, not on the API families.
      const policy =
        response.headers.get("content-security-policy") ??
        response.headers.get("content-security-policy-report-only");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    });
  });

  describe("when a caller asks for an address a mounted family declares", () => {
    it("keeps the API's own answer at /api, refusal status included", async () => {
      const response = await fetch(`${origin}/api/prompts`);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    });

    it("keeps a parameterised /api address away from the fallback", async () => {
      const response = await fetch(`${origin}/api/prompts/prompt_123`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: "prompt_123" });
    });

    it("keeps the root addresses that sit outside /api", async () => {
      for (const path of [
        "/mcp",
        "/sse",
        "/messages",
        "/oauth/token",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource/mcp",
      ]) {
        const response = await fetch(`${origin}${path}`);

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe(`mcp ${path}`);
      }
    });
  });

  describe("when a path neither the families nor the bundle carry is asked for", () => {
    it("answers 404 from the fallback rather than the shell", async () => {
      const response = await fetch(`${origin}/assets/index-missing.js`);

      expect(response.status).toBe(404);
    });
  });
});
