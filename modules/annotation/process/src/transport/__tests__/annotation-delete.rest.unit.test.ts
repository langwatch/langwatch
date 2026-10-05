/**
 * @vitest-environment node
 */
import { AnnotationNotFoundError, type AnnotationApi } from "@langwatch/annotation-contract";
import type { RestCaller } from "@langwatch/api/hosting";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { annotationRest } from "../annotation.rest.ts";

const PROJECT_ID = "project-1";

function buildApi(remove: AnnotationApi["delete"]) {
  const app = createApiFixture<AnnotationApi>({ delete: vi.fn(remove) });
  const runtime = createRestRuntime({
    identity: {
      authenticate: (): RestCaller => ({
        actor: { type: "user", id: "user-1" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
  });
  const hono = new Hono();
  hono.route(
    "/",
    runtime.mount(annotationRest.router(), { app: () => app, onError: canonicalErrorResponse }),
  );
  return (id: string) =>
    hono.request(`http://api.test/api/v1/annotations/${id}`, { method: "DELETE" });
}

describe("DELETE /api/v1/annotations/:id", () => {
  describe("when no annotation has that id in the project", () => {
    it("answers 404 annotation_not_found", async () => {
      const remove = buildApi(async ({ id }) => {
        throw new AnnotationNotFoundError(id);
      });

      const response = await remove("ann_missing");

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "annotation_not_found" });
    });
  });

  describe("when the delete fails for another reason", () => {
    it("answers a generic 500 that does not echo the database error", async () => {
      const remove = buildApi(async () => {
        throw new Error("connection to db-host:5432 refused");
      });

      const response = await remove("ann_1");

      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("db-host");
    });
  });

  describe("when the route is documented", () => {
    it("lists the 404 for an unknown id", () => {
      const route = annotationRest
        .router()
        .routes.find((candidate) => candidate.operation === "deleteAnnotation");

      expect(route?.docs?.errors).toContainEqual(
        expect.objectContaining({
          status: 404,
          description: expect.stringContaining("annotation_not_found"),
        }),
      );
    });
  });
});
