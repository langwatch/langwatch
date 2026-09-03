/**
 * Characterisation of `/api/annotations`, through the real Hono app.
 *
 * What is pinned here is the WIRE, because this family predates both response
 * envelopes and deployed callers parse what it writes: the `{ data }` wrapper
 * on every success, the `{ status, message }` shape of every refusal it
 * authors itself, the two field-specific 400 sentences, and the fact that the
 * credential's last-used clock moves only after a successful answer.
 */
import { AnnotationApp } from "#app/annotation.app";
import { AnnotationNotFoundError } from "@langwatch/annotation-contract";
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createAnnotationsRestApp, type AnnotationRestCredentialPort } from "../annotation.api";

describe("given the annotations REST family", () => {
  describe("when a project credential resolves", () => {
    it("wraps every read and write in `data` and stamps the key after answering", async () => {
      const annotation = { id: "annotation-1", comment: "looks right", isThumbsUp: true };
      const app = annotationApp({
        list: vi.fn(async () => [annotation]),
        getById: vi.fn(async () => annotation),
        update: vi.fn(async () => annotation),
        createUnattributed: vi.fn(async () => annotation),
        delete: vi.fn(async () => annotation),
      });
      const api = mount({ app });

      const list = await api.fetch("/api/annotations");
      const byId = await api.fetch("/api/annotations/annotation-1");
      const byTrace = await api.fetch("/api/annotations/trace/trace-1");
      const patch = await api.fetch("/api/annotations/annotation-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "revised", isThumbsUp: false }),
      });
      const created = await api.fetch("/api/annotations/trace/trace-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "new", isThumbsUp: true }),
      });
      const removed = await api.fetch("/api/annotations/annotation-1", { method: "DELETE" });

      expect([list.status, byId.status, byTrace.status, patch.status, created.status]).toEqual([
        200, 200, 200, 200, 200,
      ]);
      await expect(list.json()).resolves.toEqual({ data: [annotation] });
      await expect(byId.json()).resolves.toEqual({ data: annotation });
      await expect(byTrace.json()).resolves.toEqual({ data: [annotation] });
      await expect(patch.json()).resolves.toEqual({ data: annotation });
      await expect(created.json()).resolves.toEqual({ data: annotation });
      expect(removed.status).toBe(200);
      await expect(removed.json()).resolves.toEqual({
        status: "success",
        message: "Annotation deleted.",
      });
      expect(api.markUsed).toHaveBeenCalledTimes(6);
    });

    it("asks for the grain each route actually needs", async () => {
      const app = annotationApp({
        list: vi.fn(async () => []),
        createUnattributed: vi.fn(async () => ({ id: "a" })),
        delete: vi.fn(async () => ({ id: "a" })),
      });
      const api = mount({ app });

      await api.fetch("/api/annotations");
      await api.fetch("/api/annotations/trace/trace-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "new", isThumbsUp: true }),
      });
      await api.fetch("/api/annotations/annotation-1", { method: "DELETE" });

      expect(api.permissions).toEqual([
        "annotations:view",
        "annotations:create",
        "annotations:manage",
      ]);
    });

    it("names the offending field rather than reporting a generic invalid body", async () => {
      const api = mount({ app: annotationApp({}) });

      const noComment = await api.fetch("/api/annotations/trace/trace-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isThumbsUp: true }),
      });
      const noThumbs = await api.fetch("/api/annotations/annotation-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "present" }),
      });

      expect([noComment.status, noThumbs.status]).toEqual([400, 400]);
      await expect(noComment.json()).resolves.toEqual({
        status: "error",
        message: "[comment] is required in the request body and must be a string.",
      });
      await expect(noThumbs.json()).resolves.toEqual({
        status: "error",
        message: "[isThumbsUp] is required in the request body and must be a boolean.",
      });
    });

    it("answers 404 for a comment this project cannot see", async () => {
      const api = mount({
        app: annotationApp({
          getById: vi.fn(async () => {
            throw new AnnotationNotFoundError("annotation-1");
          }),
        }),
      });

      const response = await api.fetch("/api/annotations/annotation-1");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        status: "error",
        message: "Annotation not found.",
      });
    });
  });

  describe("when the credential is missing or refused", () => {
    it("publishes the refusal the port authored and never touches the service", async () => {
      const list = vi.fn(async () => []);
      const api = mount({
        app: annotationApp({ list }),
        credential: async () => ({
          ok: false,
          status: 401,
          body: { message: "Authentication token is required." },
        }),
      });

      const response = await api.fetch("/api/annotations");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        message: "Authentication token is required.",
      });
      expect(list).not.toHaveBeenCalled();
    });
  });
});

function annotationApp(methods: Record<string, unknown>): AnnotationApp {
  return new Proxy(AnnotationApp.prototype, {
    get(target, property, receiver) {
      if (property in methods) return methods[property as string];
      return Reflect.get(target, property, receiver);
    },
  }) as AnnotationApp;
}

/**
 * The family over a security spine that authenticates nothing.
 *
 * Every route on it declares `handlerManagedAuth`, so the framework chain is
 * empty by construction and the credential port IS the authentication — which
 * is exactly what these tests need to drive.
 */
function mount(options: { app: AnnotationApp; credential?: AnnotationRestCredentialPort }) {
  const markUsed = vi.fn();
  const permissions: string[] = [];
  const credential: AnnotationRestCredentialPort =
    options.credential ??
    (async ({ permission }) => {
      permissions.push(permission);
      return { ok: true, project: { id: "project-1" }, markUsed };
    });

  const hono = new Hono().route(
    "/",
    createAnnotationsRestApp({
      security: passThroughSecurity(),
      annotations: () => options.app,
      credential,
    }),
  );

  return {
    markUsed,
    permissions,
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/** No route here is expected to throw, so a failure must be legible, not swallowed. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
