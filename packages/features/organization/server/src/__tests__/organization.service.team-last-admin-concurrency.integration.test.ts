/**
 * The team's last-admin guard under two removals landing at once.
 *
 * @vitest-environment node
 *
 * Read-then-write is the failure: both removals see two admins, both pass the
 * guard, and both commit, leaving a team nobody administers. What stops the
 * second is the team row's own compare-and-swap fence, which only exists
 * against a real database — so this runs against one.
 *
 * Ported from
 * platform/app/src/server/teams/__tests__/team.service.last-admin-concurrency.integration.test.ts,
 * whose refusal was Postgres's serialization failure. On this branch the
 * membership change is fenced on the team's `updatedAt`, so the loser is
 * refused by name (`team_membership_changed`) instead.
 *
 * @see specs/members/member-role-team-restrictions.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import type {
  AuthzAccessBinding,
  AuthzGrantsService,
  AuthzService,
} from "@langwatch/authz-contract";

import {
  GroupIdentityAdapter,
  PersonalWorkspaceIdentityAdapter,
  TeamIdentityAdapter,
} from "../adapters/resource-identifiers.adapter";
import { PrismaGroupRepository } from "../repositories/prisma/prisma.group.repository";
import { PrismaOrganizationRepository } from "../repositories/prisma/prisma.organization.repository";
import { PrismaTeamRepository } from "../repositories/prisma/prisma.team.repository";
import type { OrganizationSettingsSecretPort } from "../ports/organization.port";
import { OrganizationService } from "../services/organization.service";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const passthroughSecrets: OrganizationSettingsSecretPort = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};

describe.skipIf(!DB_URL)("given a team with exactly two admins", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  /**
   * The binding reads and revocations, over the real `RoleBinding` rows the
   * fixture wrote. The scenario is about the team fence, so the bindings have
   * to be real rows rather than canned answers, but the AuthZ engine's own
   * resolution is not what is under test.
   */
  const authz = {
    listScopeBindings: async (input: {
      organizationId: string;
      scopeType: string;
      scopeIds: string[];
    }): Promise<AuthzAccessBinding[]> => {
      const rows = await prisma.roleBinding.findMany({
        where: {
          organizationId: input.organizationId,
          scopeType: input.scopeType as RoleBindingScopeType,
          scopeId: { in: input.scopeIds },
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
  } as unknown as AuthzService;

  const grants = {
    attachBindings: async () => ({ attached: [], duplicates: [] }),
    revokeBindings: async (input: { bindingIds: string[] }) => {
      const { count } = await prisma.roleBinding.deleteMany({
        where: { id: { in: input.bindingIds } },
      });
      return count;
    },
    revokeBindingsWhere: async () => 0,
  } as unknown as AuthzGrantsService;

  const organizations = OrganizationService.create({
    repository: PrismaOrganizationRepository.create(prisma, passthroughSecrets),
    teams: PrismaTeamRepository.create(prisma),
    groups: PrismaGroupRepository.create(prisma),
    identities: PersonalWorkspaceIdentityAdapter.create(),
    teamIdentities: TeamIdentityAdapter.create(),
    groupIdentities: GroupIdentityAdapter.create(),
    authz,
    grants,
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
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.teamUser.deleteMany({ where: { teamId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [firstAdminId, secondAdminId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
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
