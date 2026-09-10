/**
 * The Studio editor's two literal doors, driven through the real Hono app
 * this process's REST runtime mounts. Both resolve the session this suite
 * hands them as a fact, and answer their own 401/403 wording.
 */
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountWorkflowStudioRest } from "../workflow-studio-rest.mount.ts";
import type { HandlerManagedSession } from "../../../app/api-handler-managed-session.ts";

const PROJECT = {
  id: "project-1",
  slug: "acme",
  teamId: "team-1",
  organizationId: "organization-1",
};

function testRuntime() {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;

  return createApiRestRuntime({
    projectCredential: () => {
      throw new Error("This suite opens no project credential door");
    },
    organizationCredential: () => {
      throw new Error("This suite opens no organization credential door");
    },
    organizationIdentity: () => {
      throw new Error("This suite opens no organization credential door");
    },
    routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
    errors,
  });
}

function mount(options: {
  session: HandlerManagedSession | null;
  hasProjectPermission?: () => Promise<boolean>;
  completeCode?: () => Promise<unknown>;
}) {
  const runtime = testRuntime();
  const workflows = createApiFixture<WorkflowApi>(
    {
      hasProjectPermission: options.hasProjectPermission ?? (async () => true),
      completeCode: options.completeCode ?? (async () => ({ suggestion: "" })),
      reportStudioFailure: () => void 0,
    },
    "Workflow API",
  );
  const mounted = mountWorkflowStudioRest(runtime, {
    workflows: () => workflows,
    session: { resolve: async () => options.session, permitted: async () => true },
  });

  return {
    fetch: (path: string, init?: RequestInit) =>
      mounted.fetch(new Request(`http://api.test${path}`, init)),
  };
}

describe("given the studio code-completion door", () => {
  describe("when nobody is signed in", () => {
    it("answers its own 401 without reaching the application", async () => {
      const completeCode = vi.fn(async () => ({}));
      const api = mount({ session: null, completeCode });

      const response = await api.fetch("/api/workflows/code-completion?projectId=project-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(401);
      expect(completeCode).not.toHaveBeenCalled();
    });
  });

  describe("when a signed-in person lacks project permission", () => {
    it("answers its own 403 without reaching the application", async () => {
      const completeCode = vi.fn(async () => ({}));
      const api = mount({
        session: { user: { id: "user-1" } },
        hasProjectPermission: async () => false,
        completeCode,
      });

      const response = await api.fetch("/api/workflows/code-completion?projectId=project-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(completeCode).not.toHaveBeenCalled();
    });
  });

  describe("when a signed-in person holds the permission", () => {
    it("answers the completion the application returns", async () => {
      const completeCode = vi.fn(async () => ({ suggestion: "answer" }));
      const api = mount({ session: { user: { id: "user-1" } }, completeCode });

      const response = await api.fetch("/api/workflows/code-completion?projectId=project-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ suggestion: "answer" });
      expect(completeCode).toHaveBeenCalledWith({ projectId: PROJECT.id, body: {} });
    });
  });
});
