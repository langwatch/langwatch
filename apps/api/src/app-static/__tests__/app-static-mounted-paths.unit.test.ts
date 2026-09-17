import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { declaredPathCovers, mountedPathsOfRestFamilies } from "../app-static.surface.ts";

describe("given the SPA fallback defers to the addresses the families declare", () => {
  describe("when the families are read for their route table", () => {
    it("collects every declared path, once", () => {
      const family = new Hono();
      family.get("/api/prompts", (context) => context.text("ok"));
      family.post("/api/prompts", (context) => context.text("ok"));
      family.get("/mcp", (context) => context.text("ok"));

      expect([...mountedPathsOfRestFamilies([family])].toSorted()).toEqual(["/api/prompts", "/mcp"]);
    });

    it("drops the per-family middleware registration that matches everything", () => {
      // `app.use("*", middleware)` is how every family registers its tracer and logger.
      // Honouring it as a declared address would hand the whole origin to the API and
      // leave the browser bundle unreachable.
      const family = new Hono();
      family.use("*", async (_context, next) => next());
      family.get("/api/prompts", (context) => context.text("ok"));

      expect(mountedPathsOfRestFamilies([family])).toEqual(["/api/prompts"]);
    });
  });

  describe("when a declared pattern is compared with a requested path", () => {
    it("covers the literal address, trailing slash included", () => {
      expect(declaredPathCovers("/mcp", "/mcp")).toBe(true);
      expect(declaredPathCovers("/mcp", "/mcp/")).toBe(true);
      expect(declaredPathCovers("/mcp", "/mcp/session")).toBe(false);
      expect(declaredPathCovers("/mcp", "/mcpx")).toBe(false);
    });

    it("covers exactly one segment for a parameter", () => {
      expect(declaredPathCovers("/api/prompts/:id", "/api/prompts/prompt_1")).toBe(true);
      expect(declaredPathCovers("/api/prompts/:id", "/api/prompts")).toBe(false);
      expect(declaredPathCovers("/api/prompts/:id", "/api/prompts/prompt_1/versions")).toBe(false);
      expect(declaredPathCovers("/api/prompts/:id", "/api/prompts/")).toBe(false);
    });

    it("covers the rest of the path for a scoped wildcard", () => {
      expect(declaredPathCovers("/api/gateway/*", "/api/gateway/v1/chat")).toBe(true);
      expect(declaredPathCovers("/api/gateway/*", "/authorize")).toBe(false);
    });
  });
});
