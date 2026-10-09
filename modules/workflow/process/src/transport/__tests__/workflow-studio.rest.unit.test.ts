/** @vitest-environment node */
import { SurfaceUnverifiedError } from "@langwatch/api";
import type { Authorize } from "@langwatch/api/access";
import type { RestCaller } from "@langwatch/api/hosting";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { resolveRequestBound } from "@langwatch/plans";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { workflowStudioRest } from "../workflow-studio.rest.ts";

const signedIn: RestCaller = { actor: { type: "user", id: "user_1" }, scope: null };

/** The studio family behind a browser door granting `granted` at whatever project is asked. */
function mount({
  app,
  caller,
  granted = ["workflows:manage"],
  kind = "application",
}: {
  app: Partial<WorkflowApi>;
  caller: RestCaller | null;
  granted?: readonly string[];
  kind?: string;
}) {
  const projects: Authorize = {
    getDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => "org_1",
    projectKindOf: async () => kind,
  };
  const authorize = vi.fn(({ permission }: { permission: string }) => ({
    permitted: granted.includes(permission),
    organizationRole: null,
  }));
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the studio doors never authenticate a permission");
      },
      identify: () => {
        if (!caller) throw new SurfaceUnverifiedError("browser");

        return caller;
      },
      identifyOptional: () => caller,
      authorize,
    },
    authorization: { forRequest: () => projects },
  });

  const hono = runtime.mount(workflowStudioRest.router(), {
    app: () => createApiFixture<WorkflowApi>(app, "WorkflowApi"),
    credential: "browser",
    onError: canonicalErrorResponse,
  });

  return { hono, authorize };
}

const completionOf = (body: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});

describe("the Studio editor's doors", () => {
  /** @scenario The Studio event door hands the app the signed-in browser session */
  it("hands a posted event the signed-in user rather than nobody", async () => {
    const streamStudioEvent = vi.fn(async () => (async function* () {})());
    const { hono } = mount({ app: { streamStudioEvent }, caller: signedIn });

    const response = await hono.request("/api/workflows/post_event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_1", event: { type: "is_alive", payload: {} } }),
    });

    expect(response.status).toBe(200);
    expect(streamStudioEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1" }));
  });

  const isAlive = JSON.stringify({
    projectId: "project_1",
    event: { type: "is_alive", payload: {} },
  });
  const post = (body: string): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  /** @scenario "The Studio event door asks workflows:manage at the project the event names" */
  it("asks workflows:manage at the event's project at the door and refuses 403 without it", async () => {
    const streamStudioEvent = vi.fn();
    const { hono, authorize } = mount({
      app: { streamStudioEvent },
      caller: signedIn,
      granted: [],
    });

    const response = await hono.request("/api/workflows/post_event", post(isAlive));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "permission_denied" });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "workflows:manage",
        target: expect.objectContaining({ tier: "project", id: "project_1" }),
      }),
    );
    expect(streamStudioEvent).not.toHaveBeenCalled();
  });

  /** @scenario "The Studio event door asks workflows:manage at the project the event names" */
  it("refuses a malformed event 400 and one naming no project 422 before asking", async () => {
    const streamStudioEvent = vi.fn();
    const { hono, authorize } = mount({ app: { streamStudioEvent }, caller: signedIn });

    const malformed = await hono.request("/api/workflows/post_event", post("{not json"));
    const unnamed = await hono.request(
      "/api/workflows/post_event",
      post(JSON.stringify({ event: { type: "is_alive", payload: {} } })),
    );

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "malformed_request" });
    expect(unnamed.status).toBe(422);
    expect(await unnamed.json()).toMatchObject({ code: "validation_error" });
    expect(authorize).not.toHaveBeenCalled();
    expect(streamStudioEvent).not.toHaveBeenCalled();
  });

  /** @scenario "The Studio event door refuses an event posted to an aggregate project" */
  it("refuses an event posted to an aggregate project as read only", async () => {
    const streamStudioEvent = vi.fn();
    const { hono } = mount({ app: { streamStudioEvent }, caller: signedIn, kind: "aggregate" });

    const response = await hono.request("/api/workflows/post_event", post(isAlive));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "aggregate_project_is_read_only" });
    expect(streamStudioEvent).not.toHaveBeenCalled();
  });

  it("refuses a posted event past its cap at 413 before the app reads it", async () => {
    const streamStudioEvent = vi.fn();
    const { hono } = mount({ app: { streamStudioEvent }, caller: signedIn });
    const cap = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

    const response = await hono.request(
      "/api/workflows/post_event",
      completionOf(" ".repeat(cap + 1)),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "payload_too_large" });
    expect(streamStudioEvent).not.toHaveBeenCalled();
  });

  describe("when the editor asks for a code completion", () => {
    it("refuses a caller with no session at the door, 401, before the app runs", async () => {
      const completeCode = vi.fn();
      const { hono } = mount({ app: { completeCode }, caller: null });

      const response = await hono.request(
        "/api/workflows/code-completion?projectId=project_1",
        completionOf("{}"),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthorized" });
      expect(completeCode).not.toHaveBeenCalled();
    });

    it("asks workflows:manage at the queried project at the door and refuses 403 without it", async () => {
      const completeCode = vi.fn();
      const { hono, authorize } = mount({ app: { completeCode }, caller: signedIn, granted: [] });

      const response = await hono.request(
        "/api/workflows/code-completion?projectId=project_1",
        completionOf("{}"),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "permission_denied",
        meta: { permission: "workflows:manage" },
      });
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: "workflows:manage",
          target: expect.objectContaining({ tier: "project", id: "project_1" }),
        }),
      );
      expect(completeCode).not.toHaveBeenCalled();
    });

    it("hands a permitted caller's completion request to the app", async () => {
      const completeCode = vi.fn(async () => ({ completion: "x" }));
      const { hono } = mount({ app: { completeCode }, caller: signedIn });

      const response = await hono.request(
        "/api/workflows/code-completion?projectId=project_1",
        completionOf(JSON.stringify({ completionMetadata: { language: "python" } })),
      );

      expect(response.status).toBe(200);
      expect(completeCode).toHaveBeenCalledWith({
        projectId: "project_1",
        body: { completionMetadata: { language: "python" } },
      });
    });
  });
});
