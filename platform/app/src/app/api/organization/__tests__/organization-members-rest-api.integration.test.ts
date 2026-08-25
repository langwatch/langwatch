/**
 * @vitest-environment node
 *
 * @see specs/organizations/organization-members-rest-api.feature
 *
 * Members and invites over REST. The two self-lockout guards (a credential's
 * member can neither disable nor remove themselves), the seat limit on
 * re-enable and on invites (surfaced as the family's one code,
 * member_seat_limit_reached), and the invite link a provisioning run needs
 * when it has no email provider.
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { getApp, globalForApp, resetApp } from "~/server/app-layer/app";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { LicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  ENTERPRISE_TEST_PLAN,
  type ManagementTestOrg,
  seedManagementOrg,
  seedOrgMember,
} from "~/test-utils/managementApiOrg";
import { KSUID_RESOURCES } from "~/utils/constants";
import type * as EnvModule from "../../../../env.mjs";

// Invite creation attempts email delivery; the suite is about the API, so the
// provider call is stubbed out and delivery reporting stays observable.
vi.mock("~/server/mailer/inviteEmail", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

// Pin the email-provider configuration so `emailNotSent` reads the same on
// every machine. The service skips delivery outright when no provider key is
// configured, so without this the flag reports the runner's environment rather
// than the outcome of the send.
vi.mock("../../../../env.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof EnvModule>();
  return {
    ...original,
    env: { ...original.env, SENDGRID_API_KEY: "test-sendgrid-key" },
  };
});

import { app } from "../[[...route]]/app";

describe("Feature: Organization members and invites REST API", () => {
  const ns = `org-members-${nanoid(8)}`;

  let seeded: ManagementTestOrg;
  let lastAdminOrg: ManagementTestOrg | undefined;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;
  let teamAId: string;
  let teamBId: string;

  const authHeaders = () => ({
    Authorization: `Bearer ${seeded.adminToken}`,
    "Content-Type": "application/json",
  });

  const orgRepo = () => new PrismaOrganizationRepository(prisma);

  const bindToTeam = async ({
    userId,
    teamId,
    role,
  }: {
    userId: string;
    teamId: string;
    role: TeamUserRole;
  }) => {
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: seeded.organization.id,
        userId,
        role,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    });
  };

  beforeAll(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue(ENTERPRISE_TEST_PLAN);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
    });

    seeded = await seedManagementOrg({ prisma, ns });

    const teamA = await prisma.team.create({
      data: {
        name: `Team A ${ns}`,
        slug: `--test-team-a-${ns}`,
        organizationId: seeded.organization.id,
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        name: `Team B ${ns}`,
        slug: `--test-team-b-${ns}`,
        organizationId: seeded.organization.id,
      },
    });
    teamBId = teamB.id;
  });

  // Failure-safe: a rejecting request would otherwise leave the shrunken
  // seat plan installed and cascade into every later scenario in this suite.
  afterEach(() => {
    mockGetActivePlan.mockResolvedValue(ENTERPRISE_TEST_PLAN);
  });

  afterAll(async () => {
    try {
      await cleanupTestRows(prisma, [
        ["auditLog", { organizationId: seeded?.organization.id }],
        ["organizationInvite", { organizationId: seeded?.organization.id }],
        ["roleBinding", { organizationId: seeded?.organization.id }],
        ["apiKey", { organizationId: seeded?.organization.id }],
        ["customRole", { organizationId: seeded?.organization.id }],
        ["project", { team: { organizationId: seeded?.organization.id } }],
        ["team", { organizationId: seeded?.organization.id }],
        ["organizationUser", { organizationId: seeded?.organization.id }],
        ...(lastAdminOrg
          ? ([
              ["roleBinding", { organizationId: lastAdminOrg.organization.id }],
              ["apiKey", { organizationId: lastAdminOrg.organization.id }],
              [
                "organizationUser",
                { organizationId: lastAdminOrg.organization.id },
              ],
            ] as const)
          : []),
        ["user", { email: { endsWith: `-${ns}@example.com` } }],
        ["organization", { id: seeded?.organization.id }],
        ...(lastAdminOrg
          ? ([["organization", { id: lastAdminOrg.organization.id }]] as const)
          : []),
      ]);
    } finally {
      // The suite swapped the global app; leaving its mocked plan provider
      // installed would cascade into every later suite of the serial run.
      await resetApp();
    }
  });

  describe("given an organization with several members", () => {
    /** @scenario Listing members returns roles and status */
    it("lists active members with role and status, and disabled ones only on request", async () => {
      const active = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "list-active",
        hasOrgBinding: true,
      });
      const disabled = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "list-disabled",
      });
      await prisma.organizationUser.update({
        where: {
          userId_organizationId: {
            userId: disabled.userId,
            organizationId: seeded.organization.id,
          },
        },
        data: { disabledAt: new Date() },
      });

      const response = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/members`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      const activeRow = body.members.find(
        (member: { userId: string }) => member.userId === active.userId,
      );
      expect(activeRow).toMatchObject({
        userId: active.userId,
        role: "MEMBER",
        disabled: false,
        user: { id: active.userId, email: active.email },
      });
      expect(activeRow.user.name).toBeTruthy();
      expect(
        body.members.find(
          (member: { userId: string }) => member.userId === disabled.userId,
        ),
      ).toBeUndefined();

      const withDisabled = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members?includeDisabled=true`,
        { headers: authHeaders() },
      );
      const withDisabledBody = await withDisabled.json();
      expect(
        withDisabledBody.members.find(
          (member: { userId: string }) => member.userId === disabled.userId,
        ),
      ).toMatchObject({ disabled: true });
    });

    /** @scenario Fetching a member includes their team bindings */
    it("returns the member's teams with the role held on each", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "two-teams",
        hasOrgBinding: true,
      });
      await bindToTeam({
        userId: member.userId,
        teamId: teamAId,
        role: TeamUserRole.MEMBER,
      });
      await bindToTeam({
        userId: member.userId,
        teamId: teamBId,
        role: TeamUserRole.ADMIN,
      });

      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${member.userId}`,
        { headers: authHeaders() },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.userId).toBe(member.userId);
      expect(body.teams).toHaveLength(2);
      expect(body.teams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ teamId: teamAId, role: "MEMBER" }),
          expect.objectContaining({ teamId: teamBId, role: "ADMIN" }),
        ]),
      );
    });

    /** @scenario Changing a member's organization role takes effect */
    it("changes the organization role and reads it back", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "promote",
        hasOrgBinding: true,
      });

      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${member.userId}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ role: "ADMIN" }),
        },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).role).toBe("ADMIN");

      const readBack = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${member.userId}`,
        { headers: authHeaders() },
      );
      expect((await readBack.json()).role).toBe("ADMIN");
    });

    /** @scenario Disabling a member blocks their access */
    it("disables the member and revokes their organization role", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "disable",
        hasOrgBinding: true,
      });

      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${member.userId}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ disabled: true }),
        },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).disabled).toBe(true);

      // The access gate: a disabled membership carries no organization role.
      expect(
        await orgRepo().getUserOrgRole({
          userId: member.userId,
          organizationId: seeded.organization.id,
        }),
      ).toBeNull();
    });

    /** @scenario Re-enabling a member checks the seat limit */
    it("refuses re-enabling past the seat limit and keeps the member disabled", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "reenable",
        hasOrgBinding: true,
      });
      await prisma.organizationUser.update({
        where: {
          userId_organizationId: {
            userId: member.userId,
            organizationId: seeded.organization.id,
          },
        },
        data: { disabledAt: new Date() },
      });

      const occupied = await new LicenseEnforcementRepository(
        prisma,
      ).getMemberCount(seeded.organization.id);
      mockGetActivePlan.mockResolvedValue({
        ...ENTERPRISE_TEST_PLAN,
        maxMembers: occupied,
      });

      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${member.userId}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ disabled: false }),
        },
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.code).toBe("member_seat_limit_reached");
      expect(body.meta).toMatchObject({ limitType: "members" });

      const stored = await prisma.organizationUser.findUniqueOrThrow({
        where: {
          userId_organizationId: {
            userId: member.userId,
            organizationId: seeded.organization.id,
          },
        },
        select: { disabledAt: true },
      });
      expect(stored.disabledAt).not.toBeNull();
    });

    /** @scenario A member cannot disable themselves */
    it("refuses the acting member disabling their own membership", async () => {
      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${seeded.adminUserId}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ disabled: true }),
        },
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("cannot_disable_self");

      const stored = await prisma.organizationUser.findUniqueOrThrow({
        where: {
          userId_organizationId: {
            userId: seeded.adminUserId,
            organizationId: seeded.organization.id,
          },
        },
        select: { disabledAt: true },
      });
      expect(stored.disabledAt).toBeNull();
    });

    /** @scenario Removing a member deletes the membership */
    it("removes the member, after which they read as not found", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "remove",
        hasOrgBinding: true,
      });

      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${member.userId}`,
        { method: "DELETE", headers: authHeaders() },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);

      const readBack = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${member.userId}`,
        { headers: authHeaders() },
      );
      expect(readBack.status).toBe(404);
      expect((await readBack.json()).code).toBe("member_not_found");
    });

    /** @scenario A member cannot remove themselves */
    it("refuses the acting member removing their own membership", async () => {
      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${seeded.adminUserId}`,
        { method: "DELETE", headers: authHeaders() },
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("cannot_remove_self");

      expect(
        await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: seeded.adminUserId,
              organizationId: seeded.organization.id,
            },
          },
        }),
      ).not.toBeNull();
    });

    /** @scenario Removing the last active admin is refused */
    it("refuses removing the last active admin, keeping someone who can sign in", async () => {
      // A fresh organization holds exactly one active admin by construction,
      // and the acting credential is a service key: it acts as nobody, so the
      // self guard cannot be what refuses here, only the storage guard can.
      lastAdminOrg = await seedManagementOrg({ prisma, ns: `lastadmin-${ns}` });
      const serviceKey = await getApp().apiKeys.create({
        name: `mgmt-service-key-lastadmin-${ns}`,
        userId: null,
        createdByUserId: lastAdminOrg.adminUserId,
        organizationId: lastAdminOrg.organization.id,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: lastAdminOrg.organization.id,
          },
        ],
      });

      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${lastAdminOrg.adminUserId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${serviceKey.token}`,
            "Content-Type": "application/json",
          },
        },
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("cannot_remove_last_admin");

      expect(
        await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: lastAdminOrg.adminUserId,
              organizationId: lastAdminOrg.organization.id,
            },
          },
        }),
      ).not.toBeNull();
    });

    /** @scenario A member's access breakdown spans teams and projects */
    it("reports organization, team and project access with its origin", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "breakdown",
        hasOrgBinding: true,
      });
      const project = await prisma.project.create({
        data: {
          name: `Breakdown Project ${ns}`,
          slug: `--test-project-${ns}`,
          teamId: teamAId,
          language: "python",
          framework: "openai",
          apiKey: `test-pkey-${ns}-${nanoid(6)}`,
        },
      });
      await bindToTeam({
        userId: member.userId,
        teamId: teamAId,
        role: TeamUserRole.MEMBER,
      });
      await prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: seeded.organization.id,
          userId: member.userId,
          role: TeamUserRole.VIEWER,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: project.id,
        },
      });

      const response = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/members/${member.userId}/access`,
        { headers: authHeaders() },
      );
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.user).toMatchObject({ id: member.userId, orgRole: "MEMBER" });
      expect(body.user.orgRolePermissions).toContain("organization:view");

      const scopeTypes = body.directBindings.map(
        (binding: { scopeType: string }) => binding.scopeType,
      );
      expect(scopeTypes).toEqual(
        expect.arrayContaining(["ORGANIZATION", "TEAM", "PROJECT"]),
      );
      // Each entry names where the access comes from: the scope it was
      // granted on, and the permissions that grant carries.
      for (const binding of body.directBindings) {
        expect(binding).toHaveProperty("scopeType");
        expect(binding).toHaveProperty("scopeId");
        expect(Array.isArray(binding.permissions)).toBe(true);
      }
      const teamEntry = body.directBindings.find(
        (binding: { scopeId: string }) => binding.scopeId === teamAId,
      );
      expect(teamEntry.scopeName).toBe(`Team A ${ns}`);
    });
  });

  describe("given invites managed over REST", () => {
    /** @scenario Listing invites includes the invite link */
    it("lists a pending invite with its email, role, code and link", async () => {
      const email = `invitee-list-${ns}@example.com`;
      const create = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          invites: [
            {
              email,
              role: "MEMBER",
              teams: [{ teamId: teamAId, role: "MEMBER" }],
            },
          ],
        }),
      });
      expect(create.status).toBe(201);

      const response = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      const invite = body.invites.find(
        (entry: { email: string }) => entry.email === email,
      );
      expect(invite).toBeDefined();
      expect(invite.role).toBe("MEMBER");
      expect(invite.inviteCode).toBeTruthy();
      expect(invite.inviteUrl).toContain(invite.inviteCode);
    });

    it("records the read, because the list hands out acceptance codes", async () => {
      const response = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const listed = (await response.json()).invites.length;

      // The audit write is fire-and-forget, so the response does not wait on it.
      await vi.waitFor(async () => {
        const recorded = await prisma.auditLog.findFirst({
          where: {
            organizationId: seeded.organization.id,
            action: "management.invite.list",
          },
          orderBy: { createdAt: "desc" },
        });
        expect(recorded).not.toBeNull();
        expect((recorded?.args as { returned?: number } | null)?.returned).toBe(
          listed,
        );
      });
    });

    /** @scenario Creating invites assigns teams including a custom role */
    it("creates a batch with a custom-role team assignment and reports email delivery", async () => {
      const customRole = await prisma.customRole.create({
        data: {
          organizationId: seeded.organization.id,
          name: `Invite Role ${ns}`,
          permissions: ["project:view", "traces:view"],
          kind: "custom",
        },
      });

      const emails = [
        `invitee-custom-1-${ns}@example.com`,
        `invitee-custom-2-${ns}@example.com`,
      ];
      const response = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          invites: emails.map((email) => ({
            email,
            role: "MEMBER",
            teams: [
              { teamId: teamAId, role: "CUSTOM", customRoleId: customRole.id },
            ],
          })),
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.invites).toHaveLength(2);
      for (const invite of body.invites) {
        expect(emails).toContain(invite.email);
        expect(invite.teams).toEqual([
          expect.objectContaining({
            teamId: teamAId,
            role: "CUSTOM",
            customRoleId: customRole.id,
          }),
        ]);
        // The mailer mock resolves, so the flag is known, not merely typed:
        // asserting the type alone cannot catch an inverted flag.
        expect(invite.emailNotSent).toBe(false);
      }
    });

    /** @scenario Inviting an existing member is refused */
    it("refuses an address that already belongs to a member and writes nothing", async () => {
      const response = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          invites: [
            {
              email: seeded.adminEmail,
              role: "MEMBER",
              teams: [{ teamId: teamAId, role: "MEMBER" }],
            },
          ],
        }),
      });

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("already_organization_member");
      expect(
        await prisma.organizationInvite.findFirst({
          where: {
            organizationId: seeded.organization.id,
            email: seeded.adminEmail,
          },
        }),
      ).toBeNull();
    });

    /** @scenario A duplicate pending invite is refused */
    it("refuses a second pending invite for the same address", async () => {
      const email = `invitee-dup-${ns}@example.com`;
      const first = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          invites: [
            {
              email,
              role: "MEMBER",
              teams: [{ teamId: teamAId, role: "MEMBER" }],
            },
          ],
        }),
      });
      expect(first.status).toBe(201);

      const second = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          invites: [
            {
              email,
              role: "MEMBER",
              teams: [{ teamId: teamAId, role: "MEMBER" }],
            },
          ],
        }),
      });

      expect(second.status).toBe(409);
      expect((await second.json()).code).toBe("duplicate_invite");
      expect(
        await prisma.organizationInvite.count({
          where: { organizationId: seeded.organization.id, email },
        }),
      ).toBe(1);
    });

    /** @scenario Invites beyond the seat limit are refused */
    it("refuses a batch that would exceed the seats and creates none of it", async () => {
      const occupied = await new LicenseEnforcementRepository(
        prisma,
      ).getMemberCount(seeded.organization.id);
      mockGetActivePlan.mockResolvedValue({
        ...ENTERPRISE_TEST_PLAN,
        maxMembers: occupied + 1,
      });

      const emails = [
        `invitee-over-1-${ns}@example.com`,
        `invitee-over-2-${ns}@example.com`,
        `invitee-over-3-${ns}@example.com`,
      ];
      const response = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          invites: emails.map((email) => ({
            email,
            role: "MEMBER",
            teams: [{ teamId: teamAId, role: "MEMBER" }],
          })),
        }),
      });

      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("member_seat_limit_reached");
      expect(
        await prisma.organizationInvite.count({
          where: {
            organizationId: seeded.organization.id,
            email: { in: emails },
          },
        }),
      ).toBe(0);
    });

    /** @scenario Revoking a pending invite deletes it */
    it("revokes an invite, removes it from the list, and 404s a second revoke", async () => {
      const email = `invitee-revoke-${ns}@example.com`;
      const create = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          invites: [
            {
              email,
              role: "MEMBER",
              teams: [{ teamId: teamAId, role: "MEMBER" }],
            },
          ],
        }),
      });
      const created = await create.json();
      const inviteId = created.invites[0].id;

      const revoke = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/invites/${inviteId}`,
        { method: "DELETE", headers: authHeaders() },
      );
      expect(revoke.status).toBe(200);

      const list = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites`, {
        headers: authHeaders(),
      });
      expect(
        (await list.json()).invites.find(
          (entry: { id: string }) => entry.id === inviteId,
        ),
      ).toBeUndefined();

      const again = await app.request(`/api/organization/${MANAGEMENT_API_VERSION}/invites/${inviteId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(again.status).toBe(404);
      expect((await again.json()).code).toBe("invite_not_found");
    });
  });
});
