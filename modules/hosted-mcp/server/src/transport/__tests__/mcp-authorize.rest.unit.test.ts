/**
 * @vitest-environment node
 *
 * What the approval family declares: its address, its door, and its answers.
 */
import { describe, expect, it } from "vitest";

import { mcpAuthorizeRest } from "../mcp-authorize.rest.ts";

const declaration = mcpAuthorizeRest.router();

describe("given the hosted MCP approval declaration", () => {
  describe("when its addresses are read", () => {
    it("publishes the one literal path the consent page posts to, and no twin", () => {
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(false);
      expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
        "post /api/mcp/authorize",
      ]);
    });
  });

  describe("when the door it answers behind is read", () => {
    it("resolves no credential and asks no permission of one", () => {
      const route = declaration.routes[0];

      expect(route?.access?.kind).toBe("public");
      expect(route?.permission).toBeUndefined();
      // The body is read, never parsed: a blank field is this route's own
      // refusal, worded in OAuth terms, not a validation envelope.
      expect(route?.rawBody).toEqual({ form: "text", mediaType: "application/json" });
    });
  });

  describe("when the answers it may give are read", () => {
    it("declares the approval and every status it refuses at", () => {
      const route = declaration.routes[0];

      expect(Object.keys(route?.answers ?? {})).toEqual(["200", "400", "401", "403", "500"]);
    });
  });
});
