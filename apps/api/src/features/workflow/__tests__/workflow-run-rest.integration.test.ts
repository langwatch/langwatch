/**
 * The three URLs a synchronous studio run is started from, driven through the
 * real Hono app this process's REST runtime mounts.
 */
import type { WorkflowApi } from "@langwatch/workflow-contract";
import {
  WorkflowNotFoundError,
  WorkflowNotPublishedError,
  WorkflowVersionNotFoundError,
} from "@langwatch/workflow-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountWorkflowRunRest } from "../workflow-run-rest.mount.ts";
import type { ApiRestRuntimePorts } from "../../../app-rest/api-rest.runtime.ts";

const PROJECT = {
  id: "project-1",
  slug: "acme",
  teamId: "team-1",
  organizationId: "organization-1",
};

const jsonInit = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "hello" }),
};

function testRuntime(options: { credentialOk: boolean }) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const projectCredential: ApiRestRuntimePorts["projectCredential"] = options.credentialOk
    ? async () => ({
        ok: true as const,
        project: { ...PROJECT, isPersonal: false, ownerUserId: null },
        resolved: {
          type: "apiKey" as const,
          apiKeyId: "key-1",
          userId: null,
          organizationId: PROJECT.organizationId,
          ingestSourceType: null,
          ingestionTemplateId: null,
          project: { ...PROJECT, isPersonal: false, ownerUserId: null },
        },
        markUsed: () => void 0,
      })
    : async () => ({
        ok: false as const,
        status: 403 as const,
        body: { error: "insufficient_permissions", permission: "workflows:manage" },
      });

  return createApiRestRuntime({
    projectCredential,
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

function mount(options: { run: (...args: never[]) => unknown; credentialOk?: boolean }) {
  const runtime = testRuntime({ credentialOk: options.credentialOk ?? true });
  const workflows = createApiFixture<WorkflowApi>({ run: options.run }, "Workflow API");
  const mounted = mountWorkflowRunRest(runtime, { workflows: () => workflows });

  return {
    fetch: (path: string, init?: RequestInit) =>
      mounted.fetch(new Request(`http://api.test${path}`, init)),
  };
}

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
      const api = mount({ run, credentialOk: false });

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
