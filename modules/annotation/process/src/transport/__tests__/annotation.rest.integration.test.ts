import type { AnnotationApi } from "@langwatch/annotation-contract";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { annotationRest } from "../annotation.rest.ts";

const DRIVER_MESSAGE = "Can't reach database server at `postgres.internal.langwatch:5432` (P1001)";

describe("annotation REST transport declaration", () => {
  it("preserves the public routes, permissions, and response envelopes for the host mount", () => {
    const routes = annotationRest.router().routes;

    expect(
      routes.map((route) => ({
        method: route.method,
        path: route.path,
        operation: route.operation,
        permission: route.permission,
      })),
    ).toEqual([
      { method: "get", path: "/", operation: "listAnnotations", permission: "annotations:view" },
      { method: "get", path: "/:id", operation: "getAnnotation", permission: "annotations:view" },
      {
        method: "patch",
        path: "/:id",
        operation: "updateAnnotation",
        permission: "annotations:manage",
      },
      {
        method: "delete",
        path: "/:id",
        operation: "deleteAnnotation",
        permission: "annotations:manage",
      },
      {
        method: "get",
        path: "/trace/:id",
        operation: "listTraceAnnotations",
        permission: "annotations:view",
      },
      {
        method: "post",
        path: "/trace/:id",
        operation: "createTraceAnnotation",
        permission: "annotations:create",
      },
    ]);

    const list = routes.find((route) => route.operation === "listAnnotations");
    const get = routes.find((route) => route.operation === "getAnnotation");
    const remove = routes.find((route) => route.operation === "deleteAnnotation");

    expect(list?.output.validate({ data: [] })).toBe(true);
    expect(get?.output.validate({ data: { id: "annotation-1" } })).toBe(false);
    expect(remove?.output.validate({ status: "success", message: "Annotation deleted." })).toBe(
      true,
    );
    expect(remove?.output.validate(void 0)).toBe(false);
  });
});

describe("annotation REST read failures", () => {
  describe("given the annotation store fails with a message naming the database host", () => {
    it("answers the canonical internal_error 500 rather than the store's own message", async () => {
      const runtime = createRestRuntime({
        identity: {
          authenticate: () => ({
            actor: { type: "user", id: "user-1" },
            scope: { tier: "project", id: "project-1" },
          }),
        },
      });
      const app = runtime.mount(annotationRest.router(), {
        app: () =>
          createApiFixture<AnnotationApi>({
            list: () => Promise.reject(new Error(DRIVER_MESSAGE)),
          }),
        onError: canonicalErrorResponse,
      });

      const response = await app.fetch(new Request("http://api.test/api/annotations"));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("postgres.internal.langwatch");
      expect(body).toMatchObject({ code: "internal_error" });
    });
  });
});
