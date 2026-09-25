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
      expect(declaration.credential).toBe("organization");
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
        ["get", "/:id", "getProject", "project:view"],
        ["patch", "/:id", "updateProject", "project:update"],
        ["delete", "/:id", "archiveProject", "project:delete"],
        // Both base-key routes answer "authenticated" rather than a
        // permission: they refuse every token, so no permission would grant
        // them and none is asked for.
        ["get", "/:id/api-key", "getProjectApiKey", "authenticated"],
        ["post", "/:id/regenerate-api-key", "regenerateProjectApiKey", "authenticated"],
      ]);
    });

    /**
     * The by-id routes are reached with an ORGANIZATION credential, so a check
     * resolved at the credential's own scope would let one organization-wide
     * grant reach every project in it.
     */
    it("asks every by-id route's permission at the project its path names", () => {
      const byId = declaration.routes.filter(
        (route) => route.path.startsWith("/:id") && route.permission !== undefined,
      );

      expect(byId).toHaveLength(3);
      for (const route of byId) {
        expect([route.operation, route.permissionTarget]).toEqual([
          route.operation,
          { at: "route", param: "projectId", field: "id" },
        ]);
      }
    });

    /**
     * A permission on either base-key route would promise some credential
     * can pass it, and none can — a project administrator told "insufficient
     * permissions" widening their token is the one thing that must not work here.
     */
    it("asks no permission on either base-key route, because none would grant it", () => {
      const baseKeyRoutes = declaration.routes.filter((route) => route.path.endsWith("api-key"));

      expect(baseKeyRoutes.map((route) => route.operation)).toEqual([
        "getProjectApiKey",
        "regenerateProjectApiKey",
      ]);
      for (const route of baseKeyRoutes) {
        expect([route.operation, route.permission, route.access?.kind]).toEqual([
          route.operation,
          undefined,
          "authenticated",
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

    it("publishes a summary and at least one documented error for every operation", () => {
      for (const route of declaration.routes) {
        expect([route.operation, typeof route.docs?.summary]).toEqual([route.operation, "string"]);
        const documentedAnswers =
          Object.keys(route.docs?.responses ?? {}).length + (route.docs?.errors?.length ?? 0);
        expect([route.operation, documentedAnswers > 0]).toEqual([route.operation, true]);
      }
    });
  });
});
