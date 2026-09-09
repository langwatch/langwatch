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
      expect(declaration.routes.map((route) => [route.path, route.operation, route.methods])).toEqual(
        [["/api/user-avatar/:projectId/:id", "readUserAvatarBytes", ["get", "head"]]],
      );
    });

    it("answers behind the browser's own door, which a project key opens too", () => {
      expect(declaration.credential).toBe("session");
    });

    it("asks no permission and resolves no scope: the object's own tags are the gate", () => {
      for (const route of declaration.routes) {
        expect(route.access?.kind).toBe("deferred");
        expect(route.permission).toBeUndefined();
      }
    });

    it("writes its own bytes, and names the caller the counter keys on", () => {
      for (const route of declaration.routes) {
        expect(route.rawResponse?.produces).toEqual(["image/*"]);
        expect(route.middleware?.map((fact) => fact.name)).toEqual(["userAvatarCaller"]);
      }
    });
  });
});
