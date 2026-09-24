/**
 * @vitest-environment node
 * Namespace, dated version, resource paths, operation ids and permissions, pinned.
 * @see modules/stored-object/specs/stored-objects.feature
 */
import { describe, expect, it } from "vitest";

import { storedObjectRest } from "../stored-object.rest.ts";

const declaration = storedObjectRest.router();

describe("the stored-objects REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the family's namespace and its dated version", () => {
      expect(storedObjectRest.namespace).toBe("stored-objects");
      expect(declaration.version).toBe("2026-08-22");
      expect(declaration.addressing).toBe("dated");
    });

    it("declares resource paths, operation ids and permissions", () => {
      expect(
        declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission,
        ]),
      ).toEqual([
        ["post", "/uploads", "createStoredObjectUpload", "project:update"],
        [
          "post",
          "/uploads/:storedObjectId/confirmation",
          "confirmStoredObjectUpload",
          "project:update",
        ],
        ["put", "/uploads/:storedObjectId/content", "putStoredObjectUploadContent", undefined],
        ["get", "/:storedObjectId", "getStoredObject", "project:view"],
        ["delete", "/:storedObjectId", "deleteStoredObject", "project:manage"],
      ]);
    });

    it("declares an input and an answer for every route", () => {
      for (const route of declaration.routes) {
        expect([
          route.operation,
          route.params !== undefined || route.input !== undefined || route.query !== undefined,
        ]).toEqual([route.operation, true]);
        expect([route.operation, route.output !== undefined]).toEqual([route.operation, true]);
      }
    });
  });
});
