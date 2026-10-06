/** @vitest-environment node */
import { SurfaceUnverifiedError } from "@langwatch/api";
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
}: {
  app: Partial<WorkflowApi>;
  caller: RestCaller | null;
  granted?: readonly string[];
}) {
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

    it("hands a permitted caller's completion request to the app with the door's user", async () => {
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
        userId: "user_1",
      });
    });
  });
});
