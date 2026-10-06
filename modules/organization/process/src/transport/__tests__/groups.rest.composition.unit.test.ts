/**
 * @vitest-environment node
 * `/api/groups` against the real composed application over the module's own in-memory
 * repositories, reached with an organization credential.
 * @see specs/groups/groups-rest-api.feature
 */
import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  UnauthorizedError,
} from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { organizationModuleSetup } from "../../app/__tests__/support/organization-module-setup.ts";
import { OrganizationModule } from "../../app/organization.app.ts";
import { groupsRest } from "../group.rest.ts";
import { organizationKeyFacts } from "../organization-management.rest.ts";
import { TestAuthzApi } from "./support/test-authz-api.ts";

const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";
const ADMIN_ID = "user-admin";
const CREDENTIAL = "organization-credential";

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:groups-composition:errors",
  label: "Groups API Error",
});

/** One organization, its team and its administrator, with the groups family mounted over it. */
async function application({ foreignTeamId }: { foreignTeamId?: string } = {}) {
  const permissions = TestAuthzApi.create({
    people: [{ id: ADMIN_ID, name: "Admin", email: "admin@acme.test" }],
  });
  // The grant ceiling finds nothing beyond the administrator.
  permissions.findPermissionsBeyondCaller = async () => [];
  permissions.listOrganizationBindings = async () => [];
  permissions.getScope = async ({ teamId }) =>
    ({
      type: "team",
      id: teamId,
      organizationId: teamId === foreignTeamId ? "organization-2" : ORGANIZATION_ID,
    }) as never;
  const setup = organizationModuleSetup({ permissions });
  await setup.repositories.membership(permissions).createAndAssign({
    userId: ADMIN_ID,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: TEAM_ID,
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  const app = await OrganizationModule.create(setup);

  const admit = (request: Request) => {
    if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
      throw new UnauthorizedError("Invalid credential");
    }
    return {
      actor: { type: "user" as const, id: ADMIN_ID },
      scope: { tier: "organization" as const, id: ORGANIZATION_ID },
    };
  };
  const runtime = createRestRuntime({
    identity: {
      identify: ({ request }) => admit(request),
      authenticate: ({ request }) => admit(request),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
    entitlements: { holds: async () => true },
  });
  const hono = runtime.mount(groupsRest.router(), {
    app: () => app,
    onError,
    facts: [bindRestMiddleware(organizationKeyFacts, () => ({ apiKeyId: "key-1" }))],
  });
  const send = (path: string, init: { method?: string; body?: unknown } = {}) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { send, permissions };
}

describe("given an organization whose groups family is composed with the real application", () => {
  describe("when groups are listed with an organization credential", () => {
    /** @scenario "The groups API is reachable through the composed router" */
    it("answers 200 with the documented list, and a binding added to a group answers 201", async () => {
      const { send } = await application();
      const created = (await (
        await send("/api/groups", { method: "POST", body: { name: "Engineering" } })
      ).json()) as { id: string };

      const listed = await send("/api/groups");
      const bound = await send(`/api/groups/${created.id}/bindings`, {
        method: "POST",
        body: { role: "MEMBER", scopeType: "TEAM", scopeId: TEAM_ID },
      });

      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        data: [expect.objectContaining({ id: created.id, name: "Engineering", memberCount: 0 })],
        pagination: expect.objectContaining({ page: 1 }),
      });
      expect(bound.status).toBe(201);
      expect(await bound.json()).toMatchObject({
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: TEAM_ID,
      });
    });
  });

  describe("when a binding names a team of another organization", () => {
    /** @scenario "POST /api/groups/:id/bindings rejects cross-org scope" */
    it("answers 422 scope_not_in_organization and stores no binding", async () => {
      const { send, permissions } = await application({ foreignTeamId: "team-external" });
      const created = (await (
        await send("/api/groups", { method: "POST", body: { name: "Engineering" } })
      ).json()) as { id: string };

      const refused = await send(`/api/groups/${created.id}/bindings`, {
        method: "POST",
        body: { role: "MEMBER", scopeType: "TEAM", scopeId: "team-external" },
      });

      expect(refused.status).toBe(422);
      expect(await refused.json()).toMatchObject({ code: "scope_not_in_organization" });
      expect(permissions.bindings).toEqual([]);
    });
  });
});
