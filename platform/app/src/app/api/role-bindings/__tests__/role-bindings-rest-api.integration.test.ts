/**
 * @vitest-environment node
 *
 * @see specs/rbac/role-bindings-rest-api.feature
 *
 * Role bindings over REST: one principal per binding (user, group or API
 * key), every reference checked against the caller's organization before the
 * write, deterministic conflicts, the personal-workspace refusal, the
 * write-time organization-exclusive rule (ADR-021), and the legacy-access
 * notice on a user's first explicit binding.
 *
 * Access effects are asserted through the same resolvers the request path
 * uses (`resolveTeamPermission`, `resolveApiKeyPermission`), so "has access"
 * means what production means by it.
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { resolveTeamPermission } from "~/server/api/rbac";
import { getApp, globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import type { Session } from "~/server/auth";
import { prisma } from "~/server/db";
import { resolveApiKeyPermission } from "~/server/rbac/role-binding-resolver";
import { RoleBindingService } from "~/server/role-bindings/role-binding.service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  ENTERPRISE_TEST_PLAN,
  type ManagementTestOrg,
  seedManagementOrg,
  seedOrgMember,
} from "~/test-utils/managementApiOrg";
import { KSUID_RESOURCES } from "~/utils/constants";
import { app } from "../[[...route]]/app";

const sessionFor = (userId: string): Session =>
  ({ user: { id: userId } }) as unknown as Session;

describe("Feature: Role bindings REST API", () => {
  const ns = `rb-rest-${nanoid(8)}`;

  let seeded: ManagementTestOrg;
  let memberUserId: string;
  let teamAId: string;
  let teamBId: string;
  let projectId: string;
  let groupId: string;
  let serviceApiKeyId: string;
  let customRoleId: string;
  // Optional so a beforeAll that dies before seeding it cannot hand the
  // cleanup an undefined filter, which Prisma would treat as unfiltered.
  let foreignOrgId: string | undefined;
  let foreignTeamId: string;
  let foreignApiKeyId: string;

  const authHeaders = () => ({
    Authorization: `Bearer ${seeded.adminToken}`,
    "Content-Type": "application/json",
  });

  const postBinding = (body: Record<string, unknown>) =>
    app.request(`/api/role-bindings/${MANAGEMENT_API_VERSION}/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi
          .fn()
          .mockResolvedValue(ENTERPRISE_TEST_PLAN) as PlanProvider["getActivePlan"],
      }),
    });

    seeded = await seedManagementOrg({ prisma, ns });
    const member = await seedOrgMember({
      prisma,
      ns,
      organizationId: seeded.organization.id,
      role: OrganizationUserRole.MEMBER,
      label: "principal",
      hasOrgBinding: true,
    });
    memberUserId = member.userId;

    const teamA = await prisma.team.create({
      data: {
        name: `RB Team A ${ns}`,
        slug: `--test-rb-team-a-${ns}`,
        organizationId: seeded.organization.id,
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        name: `RB Team B ${ns}`,
        slug: `--test-rb-team-b-${ns}`,
        organizationId: seeded.organization.id,
      },
    });
    teamBId = teamB.id;

    const project = await prisma.project.create({
      data: {
        name: `RB Project ${ns}`,
        slug: `--test-rb-project-${ns}`,
        teamId: teamAId,
        language: "python",
        framework: "openai",
        apiKey: `test-pkey-${ns}-${nanoid(6)}`,
      },
    });
    projectId = project.id;

    const group = await prisma.group.create({
      data: {
        id: generate(KSUID_RESOURCES.GROUP).toString(),
        name: `RB Group ${ns}`,
        slug: `--test-rb-group-${ns}`,
        organizationId: seeded.organization.id,
      },
    });
    groupId = group.id;

    // A service key whose initial reach is a team the tested project does
    // not belong to, so any project access it gains comes from the binding
    // under test.
    const serviceKey = await getApp().apiKeys.create({
      name: `rb-service-key-${nanoid(6)}`,
      userId: null,
      createdByUserId: seeded.adminUserId,
      organizationId: seeded.organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.VIEWER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamBId,
        },
      ],
    });
    serviceApiKeyId = serviceKey.apiKey.id;

    const customRole = await prisma.customRole.create({
      data: {
        organizationId: seeded.organization.id,
        name: `RB Custom Role ${ns}`,
        permissions: ["project:view", "traces:view"],
        kind: "custom",
      },
    });
    customRoleId = customRole.id;

    const foreignOrg = await prisma.organization.create({
      data: { name: `RB Foreign Org ${ns}`, slug: `--test-rb-foreign-${ns}` },
    });
    foreignOrgId = foreignOrg.id;
    const foreignTeam = await prisma.team.create({
      data: {
        name: `RB Foreign Team ${ns}`,
        slug: `--test-rb-foreign-team-${ns}`,
        organizationId: foreignOrg.id,
      },
    });
    foreignTeamId = foreignTeam.id;
    const foreignApiKey = await prisma.apiKey.create({
      data: {
        name: `RB Foreign Key ${ns}`,
        organizationId: foreignOrg.id,
        lookupId: `--test-rb-foreign-lookup-${ns}`,
        hashedSecret: `--test-rb-foreign-secret-${ns}`,
      },
    });
    foreignApiKeyId = foreignApiKey.id;
  });

  afterAll(async () => {
    try {
      await cleanupTestRows(prisma, [
        ["groupMembership", { group: { organizationId: seeded?.organization.id } }],
        ["roleBinding", { organizationId: seeded?.organization.id }],
        ["teamUser", { team: { organizationId: seeded?.organization.id } }],
        ["apiKey", { organizationId: seeded?.organization.id }],
        ["customRole", { organizationId: seeded?.organization.id }],
        ["group", { organizationId: seeded?.organization.id }],
        ["project", { team: { organizationId: seeded?.organization.id } }],
        ["team", { organizationId: seeded?.organization.id }],
        ...(foreignOrgId
          ? ([
              ["apiKey", { organizationId: foreignOrgId }],
              ["team", { organizationId: foreignOrgId }],
            ] as const)
          : []),
        ["organizationUser", { organizationId: seeded?.organization.id }],
        ["user", { email: { endsWith: `-${ns}@example.com` } }],
        ["organization", { id: seeded?.organization.id }],
        ...(foreignOrgId ? ([["organization", { id: foreignOrgId }]] as const) : []),
      ]);
    } finally {
      // The suite swapped the global app; leaving its mocked plan provider
      // installed would cascade into every later suite of the serial run.
      await resetApp();
    }
  });

  describe("given principals of all three kinds", () => {
    /** @scenario Listing role bindings supports principal and scope filters */
    it("filters by principal and narrows further by scope", async () => {
      const userBinding = await postBinding({
        userId: memberUserId,
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: teamAId,
      });
      expect(userBinding.status).toBe(201);
      const groupBinding = await postBinding({
        groupId,
        role: "VIEWER",
        scopeType: "TEAM",
        scopeId: teamBId,
      });
      expect(groupBinding.status).toBe(201);

      const byUser = await app.request(
        `/api/role-bindings/${MANAGEMENT_API_VERSION}/?userId=${memberUserId}`,
        { headers: authHeaders() },
      );
      expect(byUser.status).toBe(200);
      const byUserBody = await byUser.json();
      expect(byUserBody.bindings.length).toBeGreaterThan(0);
      for (const binding of byUserBody.bindings) {
        expect(binding.principal).toMatchObject({
          type: "user",
          id: memberUserId,
        });
        expect(binding.principal.name).toBeTruthy();
      }

      const byTeamScope = await app.request(
        `/api/role-bindings/${MANAGEMENT_API_VERSION}/?scopeType=TEAM&scopeId=${teamAId}`,
        { headers: authHeaders() },
      );
      const byTeamScopeBody = await byTeamScope.json();
      expect(byTeamScopeBody.bindings.length).toBeGreaterThan(0);
      for (const binding of byTeamScopeBody.bindings) {
        expect(binding.scopeType).toBe("TEAM");
        expect(binding.scopeId).toBe(teamAId);
      }

      // The API-key principal from the seeding is listable too.
      const byApiKey = await app.request(
        `/api/role-bindings/${MANAGEMENT_API_VERSION}/?apiKeyId=${serviceApiKeyId}`,
        { headers: authHeaders() },
      );
      const byApiKeyBody = await byApiKey.json();
      expect(byApiKeyBody.bindings.length).toBeGreaterThan(0);
      for (const binding of byApiKeyBody.bindings) {
        expect(binding.principal).toMatchObject({
          type: "apiKey",
          id: serviceApiKeyId,
        });
      }
    });

    /** @scenario Binding a role to a user at team scope succeeds */
    it("grants the member access to the team it names", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "team-grant",
        hasOrgBinding: true,
      });

      const before = await resolveTeamPermission(
        { prisma, session: sessionFor(member.userId) },
        teamBId,
        "team:view",
      );
      expect(before.permitted).toBe(false);

      const response = await postBinding({
        userId: member.userId,
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: teamBId,
      });
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.principal).toMatchObject({
        type: "user",
        id: member.userId,
      });

      const after = await resolveTeamPermission(
        { prisma, session: sessionFor(member.userId) },
        teamBId,
        "team:view",
      );
      expect(after.permitted).toBe(true);
    });

    /** @scenario Binding a custom role to a group succeeds */
    it("stores the custom role and returns it on read-back", async () => {
      const response = await postBinding({
        groupId,
        role: "CUSTOM",
        customRoleId,
        scopeType: "PROJECT",
        scopeId: projectId,
      });
      expect(response.status).toBe(201);
      const created = await response.json();
      expect(created.customRoleId).toBe(customRoleId);

      const list = await app.request(
        `/api/role-bindings/${MANAGEMENT_API_VERSION}/?groupId=${groupId}&scopeType=PROJECT&scopeId=${projectId}`,
        { headers: authHeaders() },
      );
      const listBody = await list.json();
      const row = listBody.bindings.find(
        (binding: { id: string }) => binding.id === created.id,
      );
      expect(row).toMatchObject({
        customRoleId,
        customRoleName: `RB Custom Role ${ns}`,
      });
    });

    /** @scenario Binding a role to an API key succeeds */
    it("lets the key read the project it was bound to and refuses writes", async () => {
      const response = await postBinding({
        apiKeyId: serviceApiKeyId,
        role: "VIEWER",
        scopeType: "PROJECT",
        scopeId: projectId,
      });
      expect(response.status).toBe(201);
      expect((await response.json()).principal.type).toBe("apiKey");

      const scope = {
        type: "project" as const,
        id: projectId,
        teamId: teamAId,
      };
      expect(
        await resolveApiKeyPermission({
          prisma,
          apiKeyId: serviceApiKeyId,
          userId: null,
          organizationId: seeded.organization.id,
          scope,
          permission: "traces:view",
        }),
      ).toBe(true);
      expect(
        await resolveApiKeyPermission({
          prisma,
          apiKeyId: serviceApiKeyId,
          userId: null,
          organizationId: seeded.organization.id,
          scope,
          permission: "traces:update",
        }),
      ).toBe(false);
    });

    /** @scenario A binding naming no principal, or more than one, is refused */
    it("refuses a binding naming no principal, and one naming two", async () => {
      // The schema leaves all three principal fields optional, since which one
      // is set is what the request means rather than a shape it has to have.
      // That makes the REST boundary the place to prove both refusals: a
      // service-layer test would pass while the route accepted either body.
      const countBindings = () =>
        prisma.roleBinding.count({
          where: { organizationId: seeded.organization.id },
        });
      const before = await countBindings();

      const none = await postBinding({
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: teamBId,
      });
      expect(none.status).toBe(422);
      expect((await none.json()).code).toBe("role_binding_principal_invalid");

      const two = await postBinding({
        userId: memberUserId,
        groupId,
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: teamBId,
      });
      expect(two.status).toBe(422);
      expect((await two.json()).code).toBe("role_binding_principal_invalid");

      expect(await countBindings()).toBe(before);
    });

    /** @scenario Binding an API key from another organization is refused */
    it("refuses a foreign API key the same way as a foreign user or group", async () => {
      const where = { organizationId: seeded.organization.id };
      const before = await prisma.roleBinding.count({ where });

      const response = await postBinding({
        apiKeyId: foreignApiKeyId,
        role: "VIEWER",
        scopeType: "PROJECT",
        scopeId: projectId,
      });

      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("api_key_not_in_organization");
      expect(await prisma.roleBinding.count({ where })).toBe(before);
    });

    /** @scenario Binding to a scope from another organization is refused */
    it("refuses a foreign scope and writes nothing", async () => {
      const response = await postBinding({
        userId: memberUserId,
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: foreignTeamId,
      });

      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("scope_not_in_organization");
      expect(
        await prisma.roleBinding.count({
          where: {
            organizationId: seeded.organization.id,
            scopeId: foreignTeamId,
          },
        }),
      ).toBe(0);
    });

    /** @scenario Binding an organization-exclusive permission at team scope is refused */
    it("refuses an organization-exclusive custom role below organization scope", async () => {
      const orgExclusiveRole = await prisma.customRole.create({
        data: {
          organizationId: seeded.organization.id,
          name: `RB Org Exclusive ${ns}`,
          permissions: ["governance:view"],
          kind: "custom",
        },
      });

      const response = await postBinding({
        userId: memberUserId,
        role: "CUSTOM",
        customRoleId: orgExclusiveRole.id,
        scopeType: "TEAM",
        scopeId: teamAId,
      });

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe("org_exclusive_permission_scope");
      expect(
        await prisma.roleBinding.count({
          where: {
            organizationId: seeded.organization.id,
            customRoleId: orgExclusiveRole.id,
          },
        }),
      ).toBe(0);
    });

    /** @scenario A duplicate binding is reported as already existing */
    it("answers 409 for an identical declaration and keeps one row", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "duplicate",
        hasOrgBinding: true,
      });

      const first = await postBinding({
        userId: member.userId,
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: teamAId,
      });
      expect(first.status).toBe(201);

      const second = await postBinding({
        userId: member.userId,
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: teamAId,
      });
      expect(second.status).toBe(409);
      expect((await second.json()).code).toBe("role_binding_already_exists");

      expect(
        await prisma.roleBinding.count({
          where: {
            organizationId: seeded.organization.id,
            userId: member.userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamAId,
          },
        }),
      ).toBe(1);
    });

    describe("when the grants projection has not caught up with the write", () => {
      it("answers the created binding rather than failing a write that landed", async () => {
        const member = await seedOrgMember({
          prisma,
          ns,
          organizationId: seeded.organization.id,
          role: OrganizationUserRole.MEMBER,
          label: "lagging",
          hasOrgBinding: true,
        });
        // The listing the response is composed from is fed by the projection,
        // and the writer's wait for it is bounded and timeout-tolerant, so an
        // empty listing right after a successful append is ordinary lag.
        const lagging = vi
          .spyOn(RoleBindingService.prototype, "listForOrg")
          .mockResolvedValue([]);

        try {
          const response = await postBinding({
            userId: member.userId,
            role: "MEMBER",
            scopeType: "TEAM",
            scopeId: teamBId,
          });

          expect(response.status).toBe(201);
          const body = await response.json();
          expect(body.id).toBeTruthy();
          expect(body.principal).toEqual({
            type: "user",
            id: member.userId,
            name: null,
          });
          expect(body.role).toBe("MEMBER");
          expect(body.scopeId).toBe(teamBId);
        } finally {
          lagging.mockRestore();
        }

        // The row the caller was told about really is there.
        expect(
          await prisma.roleBinding.count({
            where: {
              organizationId: seeded.organization.id,
              userId: member.userId,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: teamBId,
            },
          }),
        ).toBe(1);
      });
    });

    /** @scenario A binding into a personal workspace is refused */
    it("refuses a personal workspace scope and writes nothing", async () => {
      const owner = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "workspace-owner",
        hasOrgBinding: true,
      });
      const personalTeam = await prisma.team.create({
        data: {
          name: `Personal ${ns}`,
          slug: `--test-rb-personal-${ns}`,
          organizationId: seeded.organization.id,
          isPersonal: true,
          ownerUserId: owner.userId,
        },
      });

      const response = await postBinding({
        userId: memberUserId,
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: personalTeam.id,
      });

      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("personal_workspace_not_managed_here");
      expect(
        await prisma.roleBinding.count({
          where: {
            organizationId: seeded.organization.id,
            scopeId: personalTeam.id,
          },
        }),
      ).toBe(0);
    });

    /** @scenario The first explicit binding for a legacy user is reported in the response */
    it("creates the binding and notes that team-derived access no longer applies", async () => {
      const legacy = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "legacy",
        hasOrgBinding: false,
      });
      await prisma.teamUser.create({
        data: {
          userId: legacy.userId,
          teamId: teamAId,
          role: TeamUserRole.MEMBER,
        },
      });

      const response = await postBinding({
        userId: legacy.userId,
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: teamAId,
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.hasLegacyAccessNotice).toBe(true);
      expect(
        await prisma.roleBinding.count({
          where: {
            organizationId: seeded.organization.id,
            userId: legacy.userId,
          },
        }),
      ).toBe(1);

      // A second binding for the same user carries no notice: the fallback
      // was already off.
      const second = await postBinding({
        userId: legacy.userId,
        role: "VIEWER",
        scopeType: "TEAM",
        scopeId: teamBId,
      });
      expect(second.status).toBe(201);
      expect((await second.json()).hasLegacyAccessNotice).toBeUndefined();
    });
  });

  describe("when bindings are deleted", () => {
    /** @scenario Deleting a binding removes it */
    it("removes the binding and with it the access it granted", async () => {
      const member = await seedOrgMember({
        prisma,
        ns,
        organizationId: seeded.organization.id,
        role: OrganizationUserRole.MEMBER,
        label: "delete-grant",
        hasOrgBinding: true,
      });
      const created = await (
        await postBinding({
          userId: member.userId,
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: teamBId,
        })
      ).json();

      expect(
        (
          await resolveTeamPermission(
            { prisma, session: sessionFor(member.userId) },
            teamBId,
            "team:view",
          )
        ).permitted,
      ).toBe(true);

      const response = await app.request(
        `/api/role-bindings/${MANAGEMENT_API_VERSION}/${created.id}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);

      expect(
        (
          await resolveTeamPermission(
            { prisma, session: sessionFor(member.userId) },
            teamBId,
            "team:view",
          )
        ).permitted,
      ).toBe(false);
    });

    /** @scenario Deleting an unknown binding returns not found */
    it("answers role_binding_not_found for an unknown id", async () => {
      const response = await app.request(
        `/api/role-bindings/${MANAGEMENT_API_VERSION}/rolebinding_${nanoid(10)}`,
        { method: "DELETE", headers: authHeaders() },
      );

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("role_binding_not_found");
    });
  });
});
