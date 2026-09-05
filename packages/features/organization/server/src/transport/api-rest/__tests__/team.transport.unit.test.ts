/**
 * The `/api/teams` REST door, at the point finding H4 of the 2026-09-04 feature-surface security pass touches it: every route that names ONE team resolves its
 * permission at that team's scope, not the organization's. The collection routes stay organization-scoped, because that is what they act on.
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import {
  createRestApiService,
  getRoutePolicy,
  type AppRestOrganizationVariables,
  type AppRestProjectVariables,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type {
  OrganizationLedgerActor,
  OrganizationService,
} from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";
import { createTeamsRestApp } from "../team.api";
import { TestOrganizationService } from "./support/test-organization-service";

const ORGANIZATION_ID = "organization-1";
const USER_ID = "user-1";
const CREDENTIAL = "organization-credential";
const LEDGER_ACTOR: OrganizationLedgerActor = { type: "user", id: USER_ID };

function spine(options: {
  granted: readonly string[];
  grantedOnTeam: Readonly<Record<string, readonly string[]>>;
}) {
  const granted = new Set(options.granted);

  const authenticateOrganization: MiddlewareHandler = async (c, next) => {
    if (c.req.header("Authorization") !== `Bearer ${CREDENTIAL}`) {
      return c.json({ error: "Unauthorized", message: "Invalid credential" }, 401);
    }
    c.set("organization", { id: ORGANIZATION_ID });
    c.set("apiKeyId", "api-key-1");
    c.set("apiKeyUserId", USER_ID);
    c.set("apiKeyOrganizationId", ORGANIZATION_ID);
    c.set("orgResolvedToken", {
      type: "apiKey-org",
      apiKeyId: "api-key-1",
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (error, c) => {
      if (HandledError.isHandled(error)) {
        return c.json(
          { error: error.code, message: error.message },
          (error.httpStatus ?? 500) as ContentfulStatusCode,
        );
      }
      return c.json({ error: "Internal server error" }, 500);
    },
    canonicalErrorHandler: (error, c) => c.json({ error: { message: error.message } }, 500),
    authenticateProject: () => async (_c, next) => next(),
    authorizeProjectPermission: () => async (_c, next) => next(),
    authorizeApiKeyCeiling: () => async (_c, next) => next(),
    authenticateOrganization: () => authenticateOrganization,
    authorizeOrganizationPermission:
      ({ permission }) =>
      async (c, next) => {
        if (!granted.has(permission)) {
          return c.json({ error: "Forbidden", message: "Missing permission" }, 403);
        }
        await next();
      },
    authorizeRouteTeamPermission:
      ({ permission, param }) =>
      async (c, next) => {
        const teamId = c.req.param(param) ?? "";
        const held = options.grantedOnTeam[teamId] ?? [];
        if (!held.includes(permission)) {
          return c.json({ error: "Forbidden", message: "Missing permission" }, 403);
        }
        await next();
      },
    authorizeRouteProjectPermission: () => async (_c, next) => next(),
    authenticateOrganizationThrowing: async (_c, next) => next(),
    authorizeOrganizationPermissionThrowing: () => async (_c, next) => next(),
  };

  return createRestApiService<AppRestProjectVariables, AppRestOrganizationVariables>(ports);
}

function buildApi(
  options: {
    organizations?: Partial<TestOrganizationService>;
    granted?: readonly string[];
    grantedOnTeam?: Readonly<Record<string, readonly string[]>>;
  } = {},
) {
  const organizations: OrganizationService = Object.assign(
    new TestOrganizationService(),
    options.organizations,
  );

  const { hono } = createTeamsRestApp({
    security: spine({
      granted: options.granted ?? ["team:view", "team:manage"],
      grantedOnTeam: options.grantedOnTeam ?? { "team-1": ["team:view", "team:manage"] },
    }),
    organizations: () => organizations,
    permissions: () => ({}) as AuthzService,
    projects: () => ({}) as ProjectService,
    ledgerActor: () => LEDGER_ACTOR,
  });

  const send = (
    path: string,
    init: { method?: string; body?: unknown; credential?: string } = {},
  ) =>
    hono.request(path, {
      ...(init.method === undefined ? {} : { method: init.method }),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: {
        Authorization: `Bearer ${init.credential ?? CREDENTIAL}`,
        "Content-Type": "application/json",
      },
    });

  return { send };
}

describe("createTeamsRestApp", () => {
  describe("given a credential whose grant covers one team and not its sibling", () => {
    it("declares every by-id route at the route's own team scope", () => {
      buildApi();

      for (const [method, path, permission] of [
        ["GET", "/api/teams/:id", "team:view"],
        ["PATCH", "/api/teams/:id", "team:manage"],
        ["DELETE", "/api/teams/:id", "team:manage"],
        ["GET", "/api/teams/:id/members", "team:view"],
        ["POST", "/api/teams/:id/members", "team:manage"],
        ["DELETE", "/api/teams/:id/members/:userId", "team:manage"],
        ["GET", "/api/teams/:id/projects", "team:view"],
      ] as const) {
        expect(getRoutePolicy(method, path)?.policy).toEqual({
          kind: "teamPermission",
          permission,
          param: "id",
        });
      }
    });

    /** @scenario A team route resolves its permission at the team it names */
    it("refuses a sibling team, and never reaches the service", async () => {
      const getTeam = vi.fn();
      const updateTeam = vi.fn();
      const archiveTeam = vi.fn();
      const removeTeamMember = vi.fn();
      const { send } = buildApi({
        organizations: { getTeam, updateTeam, archiveTeam, removeTeamMember },
      });

      expect((await send("/api/teams/team-2")).status).toBe(403);
      expect(
        (await send("/api/teams/team-2", { method: "PATCH", body: { name: "Renamed" } })).status,
      ).toBe(403);
      expect((await send("/api/teams/team-2", { method: "DELETE" })).status).toBe(403);
      expect((await send("/api/teams/team-2/members")).status).toBe(403);
      expect((await send("/api/teams/team-2/projects")).status).toBe(403);
      expect((await send("/api/teams/team-2/members/user-2", { method: "DELETE" })).status).toBe(
        403,
      );

      for (const call of [getTeam, updateTeam, archiveTeam, removeTeamMember]) {
        expect(call).not.toHaveBeenCalled();
      }
    });

    it("keeps the collection route at organization scope, where it acts", () => {
      buildApi();

      expect(getRoutePolicy("GET", "/api/teams")?.policy).toEqual({
        kind: "permission",
        permission: "team:view",
      });
    });
  });
});
