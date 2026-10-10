/**
 * @vitest-environment node
 * The avatar family's address, methods, door and access kind, pinned. Every
 * rendered `<img src="/api/user-avatar/...">` holds this path.
 * @see specs/settings/user-avatar-upload.feature
 */
import { describe, expect, it } from "vitest";

import { userAvatarRest } from "../user-avatar.rest.ts";

const declaration = userAvatarRest.router();

describe("the user-avatar REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the literal address it has always answered at, with no /api/v1 twin", () => {
      expect(userAvatarRest.namespace).toBe("user-avatar");
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(false);
      expect(
        declaration.routes.map((route) => [route.path, route.operation, route.methods]),
      ).toEqual([
        ["/api/user-avatar/:projectId/:userAvatarId", "readUserAvatarBytes", ["get", "head"]],
      ]);
    });

    it("answers behind the project-key door, since REST authenticates with API keys only", () => {
      expect(declaration.credential).toBe("project");
    });

    it("asks no permission and resolves no scope: the object's own tags are the gate", () => {
      for (const route of declaration.routes) {
        expect(route.access?.kind).toBe("deferred");
        expect(route.permission).toBeUndefined();
      }
    });

    it("answers with image bytes, counted per caller before any lookup", () => {
      for (const route of declaration.routes) {
        expect(route.response).toMatchObject({ kind: "bytes", produces: ["image/*"] });
        expect(route.rateLimit).toEqual({ requests: 240, seconds: 60 });
      }
    });
  });
});
