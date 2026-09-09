/**
 * @vitest-environment node
 * The sign-in door's addresses, methods and access kind, pinned.
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import { describe, expect, it } from "vitest";

import { authRest } from "../auth.rest.ts";

const declaration = authRest.router();

describe("the /api/auth REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("publishes its paths literally and declares no /api/v1 twin", () => {
      expect(authRest.namespace).toBe("auth");
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(false);
    });

    it("keeps every path, operation id and method", () => {
      expect(declaration.routes.map((route) => [route.path, route.operation, route.methods])).toEqual([
        ["/api/auth/validate", "validateProjectAuthToken", ["post"]],
        ["/api/auth/session", "readBrowserAuthSession", ["get"]],
        ["/api/auth/logout", "endBrowserSessionAndRedirect", ["get"]],
        ["/api/auth/logout", "endBrowserSession", ["post"]],
        ["/api/auth/*", "betterAuthHandshake", ["get"]],
      ]);
    });

    it("resolves no credential at the door, because each handler answers its own refusal", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.access?.kind]).toEqual([route.operation, "public"]);
        expect([route.operation, route.permission]).toEqual([route.operation, undefined]);
      }
    });

    it("writes its own body on every route, since the answers are Better Auth's", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.rawResponse !== undefined]).toEqual([route.operation, true]);
      }
    });

    it("answers whatever method arrives on the catch-all alone, and it is declared last", () => {
      const catchAll = declaration.routes.at(-1);

      expect(catchAll?.operation).toBe("betterAuthHandshake");
      expect(catchAll?.anyMethod).toBe(true);
      expect(declaration.routes.filter((route) => route.anyMethod === true)).toHaveLength(1);
    });
  });
});
