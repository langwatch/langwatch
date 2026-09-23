import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";
/**
 * @vitest-environment node
 *
 * Last-admin guard under concurrent removals: stopped by compare-and-swap on updatedAt.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OrganizationSettingsSecret } from "../app/organization.members.ts";
import { PrismaGroupRepository } from "../repositories/prisma/prisma.group.repository.ts";
import { PrismaOrganizationRepository } from "../repositories/prisma/prisma.organization.repository.ts";
import { PrismaTeamRepository } from "../repositories/prisma/prisma.team.repository.ts";
import { OrganizationService } from "../services/organization.service.ts";
import {
  GroupIdentityAdapter,
  PersonalWorkspaceIdentityAdapter,
  TeamIdentityAdapter,
} from "../services/resource-identifiers.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const passthroughSecrets: OrganizationSettingsSecret = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};

describe.skipIf(!DB_URL)("given a team with exactly two admins", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger(
      "langwatch:organization:test:organization-service-team-last-admin-concurrency",
    ),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  /**
   * The binding reads/revocations, over real `RoleBinding` rows — the
   * scenario is about the team fence, so bindings must be real rows, but
   * the AuthZ engine's own resolution isn't what's under test.
   */
  const authz = {
    listScopeBindings: async (
      input: Parameters<AuthzApi["listScopeBindings"]>[0],
    ): Promise<AuthzAccessBinding[]> => {
      const rows = await prisma.roleBinding.findMany({
        where: {
          organizationId: input.organizationId,
          scopeType: input.scopeType as RoleBindingScopeType,
          scopeId: { in: [...input.scopeIds] },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        groupId: row.groupId,
        apiKeyId: row.apiKeyId,
        role: row.role,
        customRoleId: row.customRoleId,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        createdAt: row.createdAt,
        user: null,
        group: null,
        apiKey: null,
        customRole: null,
      })) as AuthzAccessBinding[];
    },
  };

  const grants = {
    attachBindings: async () => ({ attached: [], duplicates: [] }),
    revokeBindings: async (input: { bindingIds: string[] }) => {
      const { count } = await prisma.roleBinding.deleteMany({
        where: { id: { in: input.bindingIds } },
      });
      void count;
    },
    revokeBindingsWhere: async () => 0,
  };
  const authzApi = createApiFixture<AuthzApi>({ ...authz, ...grants });

  const organizations = OrganizationService.create({
    repository: PrismaOrganizationRepository.create(prisma),
    teams: PrismaTeamRepository.create(prisma),
    groups: PrismaGroupRepository.create(prisma),
    identities: PersonalWorkspaceIdentityAdapter.create(),
    teamIdentities: TeamIdentityAdapter.create(),
    groupIdentities: GroupIdentityAdapter.create(),
    authz: authzApi,
    grants: authzApi,
    settingsSecrets: passthroughSecrets,
  });

  const ns = `team-last-admin-${nanoid(8)}`;
  let organizationId = "";
  let teamId = "";
  let firstAdminId = "";
  let secondAdminId = "";

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Team Last Admin Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "Shared Team", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;

    const first = await prisma.user.create({
      data: { email: `tadmin1-${ns}@example.com`, name: "First Admin" },
    });
    const second = await prisma.user.create({
      data: { email: `tadmin2-${ns}@example.com`, name: "Second Admin" },
    });
    firstAdminId = first.id;
    secondAdminId = second.id;

    await prisma.organizationUser.createMany({
      data: [firstAdminId, secondAdminId].map((userId) => ({
        userId,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      })),
    });
    await prisma.roleBinding.createMany({
      data: [firstAdminId, secondAdminId].map((userId) => ({
        organizationId,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      })),
    });
  });

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["teamUser", { teamId }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["user", { id: { in: [firstAdminId, secondAdminId] } }],
      ["organization", { id: organizationId }],
    ]);
    await connection.closeOnce();
  });

  describe("when both are removed at the same time", () => {
    /** @scenario Two team admins removed at the same time cannot both succeed */
    it("refuses one of the two and leaves the team with an admin", async () => {
      const outcomes = await Promise.allSettled([
        organizations.removeTeamMember({
          organizationId,
          teamId,
          userId: firstAdminId,
          actor: { type: "user", id: secondAdminId },
        }),
        organizations.removeTeamMember({
          organizationId,
          teamId,
          userId: secondAdminId,
          actor: { type: "user", id: firstAdminId },
        }),
      ]);

      const refused = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );
      expect(refused).toHaveLength(1);
      // Asserting the code, not merely that something rejected, is what catches
      // a regression that lets an unrelated failure pass this test for the
      // wrong reason.
      expect(refused[0]!.reason).toMatchObject({ code: "team_membership_changed" });

      const adminsLeft = await prisma.roleBinding.count({
        where: {
          organizationId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
          role: TeamUserRole.ADMIN,
        },
      });
      // Exactly one, not merely "at least one": that also passes if the
      // "winning" removal silently removed nobody.
      expect(adminsLeft).toBe(1);
    });
  });
});
