/**
 * @vitest-environment node
 * `/api/me`'s addresses, operation ids, door and permission, pinned. The CLI
 * and the desktop widget hold these paths.
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
      expect(declaration.credential).toBe("projectKey");
    });

    it("keeps every path, operation id and permission", () => {
      expect(
        declaration.routes.map((route) => [route.path, route.operation, route.permission]),
      ).toEqual([
        ["/usage", "getMyUsage", "project:view"],
        ["/project", "getMyProject", "project:view"],
      ]);
    });

    it("takes the resolved credential whole, because its class is half the decision", () => {
      const usage = declaration.routes.find((route) => route.operation === "getMyUsage");

      expect(usage?.middleware?.map((fact) => fact.name)).toEqual(["mePersonalCredential"]);
    });
  });

  describe("given a half-specified usage window", () => {
    it("refuses it, rather than silently answering for the default month", () => {
      const usage = declaration.routes.find((route) => route.operation === "getMyUsage");

      expect(usage?.query?.safeParse({ windowStartMs: 1 }).success).toBe(false);
      expect(usage?.query?.safeParse({ windowStartMs: 2, windowEndMs: 1 }).success).toBe(false);
      expect(usage?.query?.safeParse({ windowStartMs: 1, windowEndMs: 2 }).success).toBe(true);
      expect(usage?.query?.safeParse({}).success).toBe(true);
    });
  });
});
