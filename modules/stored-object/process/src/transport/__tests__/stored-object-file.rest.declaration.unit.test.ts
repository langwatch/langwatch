/**
 * @vitest-environment node
 * The byte family's addresses, methods, door and access kind, pinned.
 * @see modules/stored-object/specs/stored-objects.feature
 */
import { describe, expect, it } from "vitest";

import { storedObjectFileRest } from "../stored-object-file.rest.ts";

const declaration = storedObjectFileRest.router();

describe("the files REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the family's namespace, its literal addressing and its /api/v1 twin", () => {
      expect(storedObjectFileRest.namespace).toBe("files");
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(true);
    });

    it("answers behind the project-key door, since REST authenticates with API keys only", () => {
      expect(declaration.credential).toBe("project");
    });

    it("keeps every path, operation id and method", () => {
      expect(
        declaration.routes.map((route) => [route.path, route.operation, route.methods]),
      ).toEqual([
        [
          "/api/files/:projectId/:storedObjectId/:filename",
          "readNamedProjectStoredObjectBytes",
          ["get", "head"],
        ],
        ["/api/files/:projectId/:storedObjectId", "readProjectStoredObjectBytes", ["get", "head"]],
        ["/api/files/:storedObjectId", "readStoredObjectBytes", ["get", "head"]],
      ]);
    });

    it("hands the handler the key's project and asks no permission at the door", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.access?.kind]).toEqual([route.operation, "authenticated"]);
        expect([route.operation, route.permission]).toEqual([route.operation, undefined]);
      }
    });

    it("writes its own bytes, and names the path it addresses the object by", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.response?.kind]).toEqual([route.operation, "bytes"]);
        expect([route.operation, route.params !== undefined]).toEqual([route.operation, true]);
      }
    });
  });
});
