// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * POST /api/auth/cli/project-key — non-interactive project login. The base
 * API key is a full-access credential for the project, so handing it back is
 * gated on administrative project permission, not mere update rights.
 *
 * Spec: specs/api-keys/project-key-read-access.feature
 */
import { createAppRestSecurity } from "@langwatch/api/rest";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createGovernanceCliRestApp, type GovernanceCliRestDependencies } from "../governance-cli.rest.ts";

const CALLER = {
  user_id: "user_1",
  organization_id: "org_1",
  client_info: { hostname: "laptop" },
};

const PROJECT = {
  id: "project_1",
  slug: "the-project",
  name: "The Project",
  isPersonal: false,
  ownerUserId: null,
  apiKey: "lw-base-key-secret",
};

function mountCli(input: { permittedOnProject: ReturnType<typeof vi.fn> }) {
  const ports = {
    accessTokens: {
      resolve: vi.fn().mockResolvedValue(CALLER),
      revoke: vi.fn(),
    },
    governance: () => ({}),
    directory: () => ({
      membershipStatus: vi.fn().mockResolvedValue("active"),
      findLiveProjectBySlug: vi.fn().mockResolvedValue(PROJECT),
    }),
    ensurePersonalWorkspace: vi.fn(),
    tryFindPersonalWorkspace: vi.fn().mockResolvedValue(null),
    plans: () => ({}),
    permittedOnOrganization: vi.fn().mockResolvedValue(true),
    permittedOnProject: input.permittedOnProject,
  } as unknown as GovernanceCliRestDependencies;

  const app = createGovernanceCliRestApp({ security: passThroughSecurity(), ports });
  return {
    post: (path: string, body: unknown) =>
      app.fetch(
        new Request(`http://api.test${path}`, {
          method: "POST",
          headers: {
            Authorization: "Bearer lw_at_token",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      ),
  };
}

describe("POST /api/auth/cli/project-key", () => {
  describe("given a caller who can update but not manage the project", () => {
    /** @scenario A project member cannot read the base key */
    it("refuses the handout and discloses no base API key", async () => {
      const permittedOnProject = vi.fn(
        async (check: { permission: string }) => check.permission === "project:update",
      );
      const api = mountCli({ permittedOnProject });

      const response = await api.post("/api/auth/cli/project-key", { slug: PROJECT.slug });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(403);
      expect(body.api_key).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(PROJECT.apiKey);
    });

    it("keeps the existing refusal copy", async () => {
      const permittedOnProject = vi.fn().mockResolvedValue(false);
      const api = mountCli({ permittedOnProject });

      const response = await api.post("/api/auth/cli/project-key", { slug: PROJECT.slug });

      expect(await response.json()).toMatchObject({
        error: "forbidden",
        error_description: "You need write access to this project to retrieve its API key.",
      });
    });
  });

  describe("given a caller who can manage the project", () => {
    /** @scenario A signed-in project admin reads the base key */
    it("returns the project's base API key", async () => {
      const permittedOnProject = vi.fn(
        async (check: { permission: string }) => check.permission === "project:manage",
      );
      const api = mountCli({ permittedOnProject });

      const response = await api.post("/api/auth/cli/project-key", { slug: PROJECT.slug });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ api_key: PROJECT.apiKey });
    });
  });

  describe("when checking the caller's project permission", () => {
    it("asks for project:manage, not project:update", async () => {
      const permittedOnProject = vi.fn().mockResolvedValue(true);
      const api = mountCli({ permittedOnProject });

      await api.post("/api/auth/cli/project-key", { slug: PROJECT.slug });

      expect(permittedOnProject).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "project:manage" }),
      );
    });
  });
});

const renderHandled: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity() {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => noop,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => noop,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteTeamPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}
