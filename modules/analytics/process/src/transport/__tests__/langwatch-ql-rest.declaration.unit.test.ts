/**
 * The addresses, methods, permissions and operation ids the LangWatchQL query
 * REST family publishes at `/api/v1/query`.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { queryRest } from "../query.rest.ts";

describe("given the query REST family", () => {
  const declaration = queryRest.router();

  describe("when its addressing is read", () => {
    it("names its generation first, so a consumer learns one rule for where v1 lives", () => {
      expect({ namespace: declaration.namespace, addressing: declaration.addressing }).toEqual({
        namespace: "query",
        addressing: "v1-only",
      });
    });
  });

  describe("when its routes are read", () => {
    it("publishes the run and the schema endpoints behind analytics:view", () => {
      expect(
        declaration.routes
          .filter((route) => route.operation !== "getApiV1QueryReference")
          .map((route) => ({
            method: route.method,
            path: route.path,
            operation: route.operation,
            permission: route.permission,
          })),
      ).toEqual([
        { method: "post", path: "/", operation: "postApiV1Query", permission: "analytics:view" },
        {
          method: "get",
          path: "/schema",
          operation: "getApiV1QuerySchema",
          permission: "analytics:view",
        },
      ]);
    });

    /**
     * @scenario 'An anonymous caller is refused before reaching the handler'
     * @see specs/analytics/query-reference.feature
     */
    it("publishes the reference to any authenticated credential, naming no permission", () => {
      const reference = declaration.routes.find(
        (route) => route.operation === "getApiV1QueryReference",
      );

      expect({ method: reference?.method, path: reference?.path }).toEqual({
        method: "get",
        path: "/reference",
      });
      expect(reference?.access?.kind).toBe("authenticated");
    });

    it("asks the process for the credential's own content protections on every route", () => {
      expect(
        declaration.routes.map((route) =>
          (route.middleware ?? []).map((middleware) => middleware.name),
        ),
      ).toEqual([
        ["langWatchQLCallerProtections"],
        ["langWatchQLCallerProtections"],
        ["langWatchQLCallerProtections", "langWatchQLCallerReach"],
      ]);
    });
  });
});
