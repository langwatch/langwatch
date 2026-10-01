/**
 * @vitest-environment node
 * Namespace, dated version, resource paths, operation ids and permissions, pinned.
 * @see modules/stored-object/specs/stored-objects.feature
 */
import { ForbiddenError } from "@langwatch/api/rest";
import type { AuthzDeclaredScopeId } from "@langwatch/authorization";
import { describe, expect, it, vi } from "vitest";

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
        ["get", "/:storedObjectId/content", "getStoredObjectContent", undefined],
        ["get", "/:storedObjectId", "getStoredObject", "project:view"],
        ["delete", "/:storedObjectId", "deleteStoredObject", "project:manage"],
      ]);
    });

    it("refuses a project the key does not reach before the app is asked", async () => {
      const app = {
        createUpload: vi.fn(),
        confirmUpload: vi.fn(),
        resolveDelivery: vi.fn(),
        delete: vi.fn(),
      };
      const scope: AuthzDeclaredScopeId = { tier: "project", id: "project-own" };
      const input = {
        projectId: "project-other",
        storedObjectId: "obj-1",
        audience: "datasets:view",
      };
      for (const operation of [
        "createStoredObjectUpload",
        "confirmStoredObjectUpload",
        "getStoredObject",
        "deleteStoredObject",
      ]) {
        const route = declaration.routes.find((candidate) => candidate.operation === operation);
        if (!route) throw new Error(`no route declares "${operation}"`);
        await expect(
          Promise.resolve(
            route.handler(
              { app, input, scope, actor: null, signal: undefined } as never,
              {} as never,
            ),
          ),
        ).rejects.toThrow(ForbiddenError);
      }
      expect(app.createUpload).not.toHaveBeenCalled();
      expect(app.confirmUpload).not.toHaveBeenCalled();
      expect(app.resolveDelivery).not.toHaveBeenCalled();
      expect(app.delete).not.toHaveBeenCalled();
    });

    it("declares an input and an answer for every route", () => {
      for (const route of declaration.routes) {
        expect([
          route.operation,
          route.params !== undefined || route.input !== undefined || route.query !== undefined,
        ]).toEqual([route.operation, true]);
        expect([
          route.operation,
          route.output !== undefined || route.response?.kind === "bytes",
        ]).toEqual([route.operation, true]);
      }
    });
  });
});
