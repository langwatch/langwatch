/**
 * The three URLs a synchronous studio run is started from, driven through the
 * real Hono app the API process mounts.
 *
 * The thing worth pinning is that they are ONE handler: the legacy
 * `/api/optimization/{id}/{version}` path used to carry its own copy of the
 * run and the two had drifted to answer different status codes for identical
 * failures. So each of the three is driven here, and the three named
 * refusals — no such workflow, never published, no such committed version —
 * are checked to keep their own codes rather than collapsing into one.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  WorkflowNotFoundError,
  WorkflowNotPublishedError,
  WorkflowVersionNotFoundError,
} from "@langwatch/workflow-contract";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { mountWorkflowRunRest } from "../workflow-run-rest.mount";
import type { HandlerManagedCredential } from "../../../app/api-handler-managed-credential";

const jsonInit = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "hello" }),
};

describe("given a synchronous workflow run", () => {
  describe("when a key that may manage workflows posts inputs", () => {
    it.each([
      ["/api/workflows/workflow-1/run", undefined],
      ["/api/workflows/workflow-1/version-2/run", "version-2"],
      ["/api/optimization/workflow-1/version-2", "version-2"],
    ])("runs the composed graph service from %s", async (path, versionId) => {
      const run = vi.fn(async () => ({ status: "success", result: { answer: "hi" } }));
      const api = mount({ run });

      const response = await api.fetch(path, jsonInit);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "success",
        result: { answer: "hi" },
      });
      expect(run).toHaveBeenCalledWith({
        workflowId: "workflow-1",
        projectId: "project-1",
        inputs: { question: "hello" },
        ...(versionId ? { versionId } : {}),
      });
    });
  });

  describe("when the body is not sent as JSON", () => {
    it("refuses at 400 without reaching the graph service", async () => {
      const run = vi.fn();
      const api = mount({ run });

      const response = await api.fetch("/api/workflows/workflow-1/run", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hello",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ message: "Invalid body, expecting json" });
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("when the key lacks the permission", () => {
    it("answers the ceiling refusal as sent, before the body is even read", async () => {
      const run = vi.fn();
      const api = mount({
        run,
        credential: {
          ok: false,
          status: 403,
          body: { error: "insufficient_permissions", permission: "workflows:manage" },
        },
      });

      const response = await api.fetch("/api/workflows/workflow-1/run", jsonInit);

      expect(response.status).toBe(403);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("when the run refuses by name", () => {
    it.each([
      [() => new WorkflowNotFoundError("workflow-1"), 404, "workflow_not_found"],
      [() => new WorkflowNotPublishedError("workflow-1"), 422, "validation_error"],
      [
        () => new WorkflowVersionNotFoundError("version-2"),
        404,
        "published_workflow_version_not_found",
      ],
    ])("keeps its own code rather than collapsing to one", async (make, status, code) => {
      const api = mount({
        run: async () => {
          throw make();
        },
      });

      const response = await api.fetch("/api/workflows/workflow-1/run", jsonInit);

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: code });
    });
  });
});

// ---------------------------------------------------------------------------

function mount(options: {
  run: (...args: never[]) => unknown;
  credential?: HandlerManagedCredential;
}) {
  const credential: HandlerManagedCredential = options.credential ?? {
    ok: true,
    project: { id: "project-1", slug: "acme", teamId: "team-1" } as never,
    resolved: { type: "project" } as never,
    markUsed: () => {},
  };

  const hono = new Hono().route(
    "/",
    mountWorkflowRunRest({
      security: passThroughSecurity(),
      collaborators: {
        credential: async () => credential,
        workflows: () => ({ run: options.run }) as never,
      },
    }),
  );

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
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

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code ?? "error" }, handled.httpStatus as never);
  }
  return c.json({ error: String(error) }, 500);
};
