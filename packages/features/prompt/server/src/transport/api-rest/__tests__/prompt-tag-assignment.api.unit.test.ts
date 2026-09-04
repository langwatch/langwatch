/**
 * Finding H7 of the 2026-09-04 feature-surface security pass: the prompt
 * lookup this route makes deliberately also matches ORGANIZATION-scoped
 * prompts a sibling project owns, so the row's own `projectId` is not the one
 * the credential was authorized on. The assignment is written for the
 * authorized project.
 *
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type PlatformUrlBuilder,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  createPromptsRestApp,
  type PromptRestPorts,
  type PromptRestService,
} from "../prompt.api";

const AUTHORIZED_PROJECT = "project_authorized";
const OWNING_PROJECT = "project_owner";
const ORGANIZATION_ID = "org_1";

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  return c.json({ error: "Internal Server Error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", { id: AUTHORIZED_PROJECT, slug: "authorized" });
    await next();
  };
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

function buildApi() {
  const assignTag = vi.fn(async (input: { tag: string; versionId: string }) => ({
    configId: "prompt_1",
    versionId: input.versionId,
    promptTag: { name: input.tag },
    updatedAt: new Date("2026-09-04T00:00:00.000Z"),
  }));

  const service = {
    // The organization-scoped prompt a SIBLING project owns, which is what the
    // by-handle lookup is written to reach.
    tryGetPromptByIdOrHandle: vi.fn(async () => ({
      id: "prompt_1",
      projectId: OWNING_PROJECT,
    })),
    assignTag,
  } as unknown as PromptRestService;

  const ports: PromptRestPorts = {
    organizationMiddleware: async (c, next) => {
      c.set("organization", { id: ORGANIZATION_ID });
      await next();
    },
    platformUrl: (() => "https://app.test") as unknown as PlatformUrlBuilder,
    afterPromptCreated: () => undefined,
    uniqueConstraintTargets: () => [],
  };

  const app = createPromptsRestApp({ security: testSecurity(), prompts: () => service, ports });

  return {
    assignTag,
    assign: (handle: string, versionId: string) =>
      app.hono.request(`/api/prompts/${handle}/tags/production`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      }),
  };
}

describe("PUT /api/prompts/:id/tags/:tag", () => {
  describe("given an organization-scoped prompt a sibling project owns", () => {
    /** @scenario Assigning a tag writes into the project the caller was authorized on */
    it("writes the assignment for the authorized project, not the prompt's owner", async () => {
      const { assign, assignTag } = buildApi();

      const response = await assign("checkout-agent", "prompt_version_old");

      expect(response.status).toBe(200);
      expect(assignTag).toHaveBeenCalledWith({
        configId: "prompt_1",
        versionId: "prompt_version_old",
        tag: "production",
        projectId: AUTHORIZED_PROJECT,
        organizationId: ORGANIZATION_ID,
      });
    });
  });
});
