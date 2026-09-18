import { describe, expect, it } from "vitest";
import { annotationRest } from "../annotation.rest.ts";

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

    expect(list?.output.safeParse({ data: [] }).success).toBe(true);
    expect(get?.output.safeParse({ data: { id: "annotation-1" } }).success).toBe(false);
    expect(remove?.output.safeParse(void 0).success).toBe(true);
  });
});
