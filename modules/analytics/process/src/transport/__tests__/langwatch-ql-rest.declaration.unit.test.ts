/**
 * The addresses, methods, permissions and operation ids the LangWatchQL query
 * REST family publishes at `/api/v1/query`.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

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
    it("publishes the run and the schema endpoints to any authenticated key, naming no route permission", () => {
      expect(
        declaration.routes
          .filter((route) => route.operation !== "getApiV1QueryReference")
          .map((route) => ({
            method: route.method,
            path: route.path,
            operation: route.operation,
            permission: route.permission,
            access: route.access?.kind,
          })),
      ).toEqual([
        {
          method: "post",
          path: "/",
          operation: "postApiV1Query",
          permission: undefined,
          access: "authenticated",
        },
        {
          method: "get",
          path: "/schema",
          operation: "getApiV1QuerySchema",
          permission: undefined,
          access: "authenticated",
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

    it("asks the process for the key it authenticated on every route, and nothing else", () => {
      expect(
        declaration.routes.map((route) =>
          (route.middleware ?? []).map((middleware) => middleware.name),
        ),
      ).toEqual([["langWatchQLKeyReach"], ["langWatchQLKeyReach"], ["langWatchQLKeyReach"]]);
    });

    /** @scenario "The OpenAPI descriptions for both query routes name the any-key scope rule" */
    it("describes the any-key scope rule on both the run and the schema door", () => {
      for (const operation of ["postApiV1Query", "getApiV1QuerySchema"]) {
        const description =
          declaration.routes.find((route) => route.operation === operation)?.docs?.description ??
          "";

        expect(description, operation).toContain("analytics:view");
        expect(description, operation).toContain(
          "an organization or personal key spans its projects",
        );
        expect(description, operation).toContain("MULTI_PROJECT_RESULT");
        expect(description, operation).not.toContain("X-Project-Id");
        expect(description, operation).not.toContain("project_scope_required");
      }
    });
  });
  describe("when the published documents of the run and schema doors are read", () => {
    const routeOf = (operation: string) =>
      declaration.routes.find((route) => route.operation === operation);
    const runDescription = routeOf("postApiV1Query")?.docs?.description ?? "";

    /** @scenario "The published OpenAPI schema for the schema endpoint declares the functions field" */
    it("declares a functions field typed as an array of strings", () => {
      const output = routeOf("getApiV1QuerySchema")?.output;
      const published = output
        ? (z.toJSONSchema(output) as {
            properties?: { functions?: { type?: string; items?: { type?: string } } };
          })
        : {};

      expect(published.properties?.functions?.type).toBe("array");
      expect(published.properties?.functions?.items?.type).toBe("string");
    });

    it("states the appended row cap, the LIMIT_TOO_HIGH refusal and the byte hard error", () => {
      expect(runDescription).toMatch(/10,?000\s*rows?/i);
      expect(runDescription).toMatch(/8,?000,?000\s*bytes?/i);
      expect(runDescription).toContain("LIMIT_TOO_HIGH");
      expect(runDescription).toContain("lwql_result_too_large");
      expect(runDescription).toContain("OFFSET");
    });

    /** @scenario "Each UNION branch must carry its own LIMIT ceiling" */
    it("documents LIMIT_REQUIRED_PER_BRANCH for UNION queries", () => {
      expect(runDescription).toContain("LIMIT_REQUIRED_PER_BRANCH");
      expect(runDescription).toContain("UNION");
    });

    it("advertises no truncated flag and no RESULT_TRUNCATED diagnostic", () => {
      const output = routeOf("postApiV1Query")?.output;
      const published = output
        ? (z.toJSONSchema(output) as { properties?: Record<string, unknown> })
        : {};

      expect(runDescription).not.toContain("RESULT_TRUNCATED");
      expect(published.properties).toBeDefined();
      expect(published.properties).not.toHaveProperty("truncated");
    });
  });
});
