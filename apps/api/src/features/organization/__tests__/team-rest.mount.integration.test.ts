/**
 * The teams REST family — `/api/teams` — driven through the runtime's own
 * `mount`, not a hand-rolled Hono app.
 * @see specs/security/resource-scope-permission-checks.feature
 */
// @vitest-environment node
import type { RestOrganizationIdentity, RestResolvedOrganizationCredential } from "@langwatch/api/rest";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountTeamsRest } from "../team-rest.mount.ts";

const ORGANIZATION: RestOrganizationIdentity = {
  id: "organization-1",
  slug: "acme",
};

describe("given an organization credential on the teams door", () => {
  describe("when listing teams", () => {
    it("calls the organization app's listTeams method", async () => {
      const world = mountTeams({
        listTeams: vi.fn(async () => ({
          data: [
            {
              id: "team-1",
              name: "Team 1",
              slug: "team-1",
              organizationId: "organization-1",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          pagination: { page: 1, limit: 50, total: 1 },
        })),
      });

      const response = await world.send("/api/teams", {
        method: "GET",
        headers: { Authorization: "Bearer org-credential" },
      });

      expect(response.status).toBe(200);
    });
  });
});

function mountTeams(appOverrides: Record<string, any>) {
  const resolved: RestResolvedOrganizationCredential = {
    type: "organization",
    organization: ORGANIZATION,
  };

  const runtime = createApiRestRuntime({
    projectCredential: () => {
      throw new Error("This suite composed no project credential door.");
    },
    organizationCredential: () =>
      Promise.resolve({
        ok: true,
        organization: { id: ORGANIZATION.id },
        resolved,
        markUsed: () => {},
      }),
    organizationIdentity: () => resolved,
    routeAuthorization: () => {
      throw new Error("This suite does not authorize route-scoped permissions.");
    },
    errors: { legacyErrorHandler: (_, c) => c.json({ error: "Error" }, 500) },
  });

  const mounted = mountTeamsRest(runtime, {
    organization: () =>
      ({
        listTeams: appOverrides.listTeams ?? vi.fn(),
        getTeam: appOverrides.getTeam ?? vi.fn(),
        createTeam: appOverrides.createTeam ?? vi.fn(),
        updateTeam: appOverrides.updateTeam ?? vi.fn(),
        archiveTeam: appOverrides.archiveTeam ?? vi.fn(),
        addTeamMember: appOverrides.addTeamMember ?? vi.fn(),
        removeTeamMember: appOverrides.removeTeamMember ?? vi.fn(),
      }) as never,
    authz: () =>
      ({
        listScopeBindings: appOverrides.listScopeBindings ?? vi.fn(async () => []),
      }) as never,
    projects: () =>
      ({
        listByTeam: appOverrides.listByTeam ?? vi.fn(async () => []),
      }) as never,
  });

  const hono = new Hono().route("/", mounted);

  return {
    send: (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: init.method ?? "GET",
          headers: init.headers ?? {},
        }),
      ),
  };
}
