/**
 * @vitest-environment node
 * Namespace, door, dated version, addressing, paths, operation ids and the
 * scope each permission is asked at, pinned. The operation ids become the
 * Python SDK's function names, so a rename here renames somebody's method.
 */
import { describe, expect, it } from "vitest";

import { projectRest } from "../project.rest.ts";

const declaration = projectRest.router();

describe("the projects REST declaration", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the family's namespace, door, dated version and addressing", () => {
      expect(projectRest.namespace).toBe("projects");
      expect(declaration.credential).toBe("organizationKey");
      expect(declaration.version).toBe("2026-08-07");
      expect(declaration.addressing).toBe("dated");
      // `/api/v1/projects` belongs to the LangWatch-QL family.
      expect(declaration.v1Twin).toBe(false);
    });

    it("keeps every path, method, operation id and permission", () => {
      expect(
        declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission ?? route.access?.kind,
        ]),
      ).toEqual([
        ["get", "/", "listProjects", "authenticated"],
        ["post", "/", "createProject", "project:create"],
        ["get", "/:projectId", "getProject", "project:view"],
        ["patch", "/:projectId", "updateProject", "project:update"],
        ["delete", "/:projectId", "archiveProject", "project:delete"],
        ["get", "/:projectId/api-key", "getProjectApiKey", "project:update"],
        [
          "post",
          "/:projectId/regenerate-api-key",
          "regenerateProjectApiKey",
          "project:manage",
        ],
      ]);
    });

    /**
     * The by-id routes are reached with an ORGANIZATION credential, so a check
     * resolved at the credential's own scope would let one organization-wide
     * grant reach every project in it.
     */
    it("asks every by-id route's permission at the project its path names", () => {
      const byId = declaration.routes.filter((route) => route.path.startsWith("/:projectId"));

      expect(byId).toHaveLength(5);
      for (const route of byId) {
        expect([route.operation, route.permissionTarget]).toEqual([
          route.operation,
          { at: "route", param: "projectId" },
        ]);
      }
    });

    it("asks the collection routes at the credential's own scope", () => {
      for (const route of declaration.routes.filter((r) => r.path === "/")) {
        expect([route.operation, route.permissionTarget]).toEqual([route.operation, undefined]);
      }
    });

    it("declares an answer for every route, and 201 for the provisioning alone", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.output !== undefined]).toEqual([route.operation, true]);
      }

      expect(declaration.routes.map((route) => [route.operation, route.status])).toEqual([
        ["listProjects", undefined],
        ["createProject", 201],
        ["getProject", undefined],
        ["updateProject", undefined],
        ["archiveProject", undefined],
        ["getProjectApiKey", undefined],
        ["regenerateProjectApiKey", undefined],
      ]);
    });

    // The listing and the provisioning both ask about the KEY as well as the
    // member it acts as; the by-id routes ask about neither.
    it("binds the credential fact on the two collection routes alone", () => {
      expect(
        declaration.routes.map((route) => [
          route.operation,
          route.middleware?.map((fact) => fact.name) ?? [],
        ]),
      ).toEqual([
        ["listProjects", ["projectRestCredential"]],
        ["createProject", ["projectRestCredential"]],
        ["getProject", []],
        ["updateProject", []],
        ["archiveProject", []],
        ["getProjectApiKey", []],
        ["regenerateProjectApiKey", []],
      ]);
    });

    it("publishes a summary and documented answers for every operation", () => {
      for (const route of declaration.routes) {
        expect([route.operation, typeof route.docs?.summary]).toEqual([route.operation, "string"]);
        expect([route.operation, Object.keys(route.docs?.responses ?? {}).length > 0]).toEqual([
          route.operation,
          true,
        ]);
      }
    });
  });
});
