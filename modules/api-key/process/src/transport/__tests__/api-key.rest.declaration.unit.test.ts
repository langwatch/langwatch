/**
 * @vitest-environment node
 * Namespace, door, dated version, paths, operation ids and permissions, pinned.
 * @see specs/api-keys/api-keys-management-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import { apiKeyRest } from "../api-key.rest.ts";

const declaration = apiKeyRest.router();

describe("the api-keys REST declaration", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the family's namespace, door, dated version and addressing", () => {
      expect(apiKeyRest.namespace).toBe("api-keys");
      expect(declaration.credential).toBe("organization");
      expect(declaration.version).toBe("2026-08-07");
      expect(declaration.addressing).toBe("dated");
      expect(declaration.v1Twin).toBe(true);
    });

    it("keeps every path, method, operation id and permission", () => {
      expect(
        declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission,
        ]),
      ).toEqual([
        ["get", "/", "listApiKeys", "organization:view"],
        ["post", "/", "createApiKey", "organization:manage"],
        ["get", "/:id", "getApiKey", "organization:view"],
        ["patch", "/:id", "updateApiKey", "organization:manage"],
        ["delete", "/:id", "revokeApiKey", "organization:manage"],
      ]);
    });

    it("declares an answer for every route, and 201 for the mint alone", () => {
      const statuses = declaration.routes.map((route) => [route.operation, route.status]);

      for (const route of declaration.routes) {
        expect([route.operation, route.output !== undefined]).toEqual([route.operation, true]);
      }
      expect(statuses).toEqual([
        ["listApiKeys", undefined],
        ["createApiKey", 201],
        ["getApiKey", undefined],
        ["updateApiKey", undefined],
        ["revokeApiKey", undefined],
      ]);
    });

    // Two questions this family asks are about the KEY as well as the member
    // it acts as, so every route reads the credential the door resolved.
    it("binds the credential fact on every route", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.middleware?.map((fact) => fact.name)]).toEqual([
          route.operation,
          ["apiKeyRestCredential"],
        ]);
      }
    });

    it("publishes the summary each operation has always carried", () => {
      expect(declaration.routes.map((route) => route.docs?.summary)).toEqual([
        "List API keys",
        "Create an API key",
        "Get an API key",
        "Update an API key",
        "Revoke an API key",
      ]);
    });
  });
});
