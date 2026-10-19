/**
 * @vitest-environment node
 * `/api/me`'s addresses, operation ids, door and permission, pinned. The CLI
 * and the desktop widget hold these paths; `/usage` is governance's (me-usage.rest.ts).
 */
import { describe, expect, it } from "vitest";

import { meRest } from "../me.rest.ts";

const declaration = meRest.router();

describe("the me REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the namespace, its dated addressing and its /api/v1 twin", () => {
      expect(meRest.namespace).toBe("me");
      expect(declaration.addressing).toBe("dated");
      expect(declaration.v1Twin).toBe(true);
      expect(declaration.version).toBe("2026-08-07");
    });

    it("answers behind a project API key", () => {
      expect(declaration.credential).toBe("project");
    });

    it("keeps every path, operation id and permission", () => {
      expect(
        declaration.routes.map((route) => [route.path, route.operation, route.permission]),
      ).toEqual([["/project", "getApiMeProject", "project:view"]]);
    });
  });
});
