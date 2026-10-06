import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  UnauthorizedError,
} from "@langwatch/api/rest";
/**
 * @vitest-environment node
 * `/api/organization` members and invites against the real composed application over the
 * module's own in-memory repositories: a request changes state, a follow-up request reads it.
 * @see specs/organizations/organization-members-rest-api.feature
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { organizationModuleSetup } from "../../app/__tests__/support/organization-module-setup.ts";
import { OrganizationModule } from "../../app/organization.app.ts";
import {
  organizationKeyFacts,
  organizationManagementRest,
} from "../organization-management.rest.ts";
import { TestAuthzApi } from "./support/test-authz-api.ts";

const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";
const PERSONAL_TEAM_ID = "team-personal";
const ADMIN_ID = "user-admin";
const MEMBER_ID = "user-member";
const CREDENTIAL = "organization-credential";

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:organization-members:errors",
  label: "Organization API Error",
});

const roomyPlan: Plan = {
  planSource: "free",
  type: "free",
  name: "Free",
  free: true,
  maxMembers: 1_000_000,
  maxMembersLite: 1_000_000,
  maxMessagesPerMonth: 1_000_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

/**
 * One organization with an administrator (the person the credential acts as), a member, a shared
 * team, and the administrator's personal workspace;
 * the family mounted over the real application.
 */
async function application({ plan = {} }: { plan?: Partial<Plan> } = {}) {
  const permissions = TestAuthzApi.create({
    people: [
      { id: ADMIN_ID, name: "Admin", email: "admin@acme.test" },
      { id: MEMBER_ID, name: "Member", email: "member@acme.test" },
    ],
  });
  // The ceiling check finds nothing beyond the administrator; a cache invalidation is a no-op.
  permissions.findPermissionsBeyondCaller = async () => [];
  permissions.invalidateOrganization = async () => {};
  const revokedSessions: string[] = [];
  const setup = organizationModuleSetup({
    permissions,
    users: createApiFixture<UserApi>(
      {
        revokeAllBrowserSessions: async ({ userId }) => {
          revokedSessions.push(userId);
        },
      },
      "UserApi",
    ),
    entitlement: createApiFixture<EntitlementApi>(
      { getActivePlan: async () => ({ ...roomyPlan, ...plan }), requestBound: async () => 1_000 },
      "EntitlementApi",
    ),
    identity: createApiFixture<IdentityApi>(
      { verifiedEmailsOf: async () => ({ kind: "keep_legacy" }) },
      "IdentityApi",
    ),
  });
  const { repositories } = setup;
  const membership = repositories.membership(permissions);
  await membership.createAndAssign({
    userId: ADMIN_ID,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: TEAM_ID,
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  await membership.createMembership({
    organizationId: ORGANIZATION_ID,
    userId: MEMBER_ID,
    pendingAdmissionId: "admission-member",
    via: "invite",
  });
  await repositories.organization.ensurePersonalWorkspace({
    workspace: { userId: ADMIN_ID, organizationId: ORGANIZATION_ID, displayName: "Admin" },
    resources: {
      teamId: PERSONAL_TEAM_ID,
      teamSlug: "--personal-admin",
      projectId: "project_personal",
      projectSlug: "personal-admin",
      projectApiKey: "sk-lw-personal",
      ownerBindingId: "binding-admin-personal",
    },
  });
  const app = await OrganizationModule.create(setup);

  const runtime = createRestRuntime({
    identity: {
      identify: ({ request }) => {
        if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
          throw new UnauthorizedError("Invalid credential");
        }
        return {
          actor: { type: "user" as const, id: ADMIN_ID },
          scope: { tier: "organization" as const, id: ORGANIZATION_ID },
        };
      },
      authenticate: ({ request }) => {
        if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
          throw new UnauthorizedError("Invalid credential");
        }
        return {
          actor: { type: "user" as const, id: ADMIN_ID },
          scope: { tier: "organization" as const, id: ORGANIZATION_ID },
        };
      },
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
    entitlements: { holds: async () => true },
  });
  const hono = runtime.mount(organizationManagementRest.router(), {
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

  return { app, send, revokedSessions };
}

type Refusal = { code: string; status: number };
type Member = { userId: string; role: string; disabled: boolean };
type InviteList = {
  invites: { email: string; status: string; teams: { teamId: string }[] }[];
};

const invite = (email: string, teamId: string = TEAM_ID) => ({
  email,
  role: "MEMBER",
  teams: [{ teamId, role: "MEMBER" }],
});

describe("given an organization with an administrator and a member", () => {
  describe("when the member's organization role is changed to admin", () => {
    /** @scenario "Changing a member's organization role takes effect" */
    it("answers 200 and fetching the member returns the admin role", async () => {
      const { send } = await application();

      const changed = await send(`/api/organization/members/${MEMBER_ID}`, {
        method: "PATCH",
        body: { role: "ADMIN" },
      });
      const fetched = await send(`/api/organization/members/${MEMBER_ID}`);

      expect(changed.status).toBe(200);
      expect(fetched.status).toBe(200);
      expect(await fetched.json()).toMatchObject({ userId: MEMBER_ID, role: "ADMIN" });
    });
  });

  describe("when the member is disabled", () => {
    /** @scenario "Disabling a member blocks their access" */
    it("answers 200, reports them disabled and no longer lists the organization to them", async () => {
      const { app, send, revokedSessions } = await application();
      expect(
        (await app.organizationIdsForMember({ userId: MEMBER_ID })).includes(ORGANIZATION_ID),
      ).toBe(true);

      const disabled = await send(`/api/organization/members/${MEMBER_ID}`, {
        method: "PATCH",
        body: { disabled: true },
      });
      const fetched = await send(`/api/organization/members/${MEMBER_ID}`);
      const reachable = await app.getAllForUser(
        { isDemo: false, demoProjectUserId: "", demoProjectId: "" },
        { id: MEMBER_ID },
      );

      expect(disabled.status).toBe(200);
      expect(revokedSessions).toEqual([MEMBER_ID]);
      expect(await disabled.json()).toMatchObject({ userId: MEMBER_ID, disabled: true });
      expect(await fetched.json()).toMatchObject({ userId: MEMBER_ID, disabled: true });
      expect(reachable.map((organization) => organization.id)).not.toContain(ORGANIZATION_ID);
    });
  });

  describe("when the member is removed", () => {
    /** @scenario "Removing a member deletes the membership" */
    it("answers 200 and fetching them afterwards is refused with member_not_found and 404", async () => {
      const { send } = await application();

      const removed = await send(`/api/organization/members/${MEMBER_ID}`, { method: "DELETE" });
      const fetched = await send(`/api/organization/members/${MEMBER_ID}`);
      const roster = (await (await send("/api/organization/members")).json()) as {
        members: Member[];
      };

      expect(removed.status).toBe(200);
      expect(fetched.status).toBe(404);
      expect(((await fetched.json()) as Refusal).code).toBe("member_not_found");
      expect(roster.members.map((entry) => entry.userId)).toEqual([ADMIN_ID]);
    });
  });
});

describe("given an organization with a team and a personal workspace", () => {
  describe("when the same address is invited twice", () => {
    /** @scenario "A duplicate pending invite is refused" */
    it("refuses the second with duplicate_invite and 409 and keeps one invite", async () => {
      const { send } = await application();
      const first = await send("/api/organization/invites", {
        method: "POST",
        body: { invites: [invite("dup@acme.test")] },
      });

      const second = await send("/api/organization/invites", {
        method: "POST",
        body: { invites: [invite("dup@acme.test")] },
      });
      const listed = (await (await send("/api/organization/invites")).json()) as InviteList;

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(((await second.json()) as Refusal).code).toBe("duplicate_invite");
      expect(listed.invites.filter((entry) => entry.email === "dup@acme.test")).toHaveLength(1);
    });
  });

  describe("when the personal workspace is named in an invite", () => {
    /** @scenario "An invite cannot assign a personal workspace team" */
    it("refuses with personal_workspace_not_managed_here and 403 and creates no invite", async () => {
      const { send } = await application();

      const refused = await send("/api/organization/invites", {
        method: "POST",
        body: { invites: [invite("someone@acme.test", PERSONAL_TEAM_ID)] },
      });
      const listed = (await (await send("/api/organization/invites")).json()) as InviteList;

      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Refusal).code).toBe("personal_workspace_not_managed_here");
      expect(listed.invites).toEqual([]);
    });
  });
});

describe("given a plan with one seat left", () => {
  describe("when three people are invited at once", () => {
    /** @scenario "Invites beyond the seat limit are refused" */
    it("refuses with member_seat_limit_reached and 403 and creates no invite", async () => {
      const { send } = await application({ plan: { maxMembers: 3 } });

      const refused = await send("/api/organization/invites", {
        method: "POST",
        body: {
          invites: [invite("a@acme.test"), invite("b@acme.test"), invite("c@acme.test")],
        },
      });
      const listed = (await (await send("/api/organization/invites")).json()) as InviteList;

      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Refusal).code).toBe("member_seat_limit_reached");
      expect(listed.invites).toEqual([]);
    });

    it("admits one person on the same plan, so the batch size is what was refused", async () => {
      const { send } = await application({ plan: { maxMembers: 3 } });

      const admitted = await send("/api/organization/invites", {
        method: "POST",
        body: { invites: [invite("a@acme.test")] },
      });

      expect(admitted.status).toBe(201);
    });
  });
});
