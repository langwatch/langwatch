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
import { GroupIdentityService } from "../services/group-identity.service.ts";
import { OrganizationService } from "../services/organization.service.ts";
import { PersonalWorkspaceIdentityService } from "../services/personal-workspace-identity.service.ts";
import { TeamIdentityService } from "../services/team-identity.service.ts";

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

  let revocationStarted: () => void = () => undefined;
  let revocationDelayMs = 0;
  const grants = {
    attachBindings: async () => ({ attached: [], duplicates: [] }),
    revokeBindings: async (input: { bindingIds: string[] }) => {
      revocationStarted();
      await new Promise((resolve) => setTimeout(resolve, revocationDelayMs));
      await prisma.roleBinding.deleteMany({ where: { id: { in: input.bindingIds } } });
    },
    revokeBindingsWhere: async () => 0,
  };
  const authzApi = createApiFixture<AuthzApi>({ ...authz, ...grants });

  const organizations = OrganizationService.create({
    repository: PrismaOrganizationRepository.create(prisma),
    teams: PrismaTeamRepository.create(prisma),
    groups: PrismaGroupRepository.create(prisma),
    identities: PersonalWorkspaceIdentityService.create(),
    teamIdentities: TeamIdentityService.create(),
    groupIdentities: GroupIdentityService.create(),
    authz: authzApi,
    grants: authzApi,
    settingsSecrets: passthroughSecrets,
  });

  const ns = `team-last-admin-${nanoid(8)}`;
  let organizationId = "";
  let firstAdminId = "";
  let secondAdminId = "";

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Team Last Admin Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
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
  });

  async function seedTeamWithTwoAdmins(): Promise<string> {
    const team = await prisma.team.create({
      data: { name: "Shared Team", slug: `--test-team-${ns}-${nanoid(6)}`, organizationId },
    });
    await prisma.roleBinding.createMany({
      data: [firstAdminId, secondAdminId].map((userId) => ({
        organizationId,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      })),
    });
    return team.id;
  }

  function removeEachOther(teamId: string) {
    return [
      () =>
        organizations.removeTeamMember({
          organizationId,
          teamId,
          userId: firstAdminId,
          actor: { type: "user", id: secondAdminId },
        }),
      () =>
        organizations.removeTeamMember({
          organizationId,
          teamId,
          userId: secondAdminId,
          actor: { type: "user", id: firstAdminId },
        }),
    ] as const;
  }

  async function expectExactlyOneRefusedAndOneAdminLeft(
    teamId: string,
    outcomes: PromiseSettledResult<void>[],
  ): Promise<void> {
    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(refused).toHaveLength(1);
    // The code, not merely a rejection: an unrelated failure must not pass. The
    // fence refuses a removal holding a stale read; the guard one that read after.
    expect(["team_membership_changed", "team_last_admin_required"]).toContain(
      (refused[0]!.reason as { code?: string }).code,
    );
    const adminsLeft = await prisma.roleBinding.count({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
        role: TeamUserRole.ADMIN,
      },
    });
    // Exactly one: "at least one" also passes if the winner removed nobody.
    expect(adminsLeft).toBe(1);
  }

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["teamUser", { team: { organizationId } }],
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
      const teamId = await seedTeamWithTwoAdmins();
      revocationDelayMs = 0;
      const [removeFirst, removeSecond] = removeEachOther(teamId);

      const outcomes = await Promise.allSettled([removeFirst(), removeSecond()]);

      await expectExactlyOneRefusedAndOneAdminLeft(teamId, outcomes);
    });
  });

  describe("when one removal starts while the other is still revoking", () => {
    /** @scenario A team admin removal that starts while another is being written is refused */
    it("refuses the later one and leaves the team with an admin", async () => {
      const teamId = await seedTeamWithTwoAdmins();
      revocationDelayMs = 300;
      const [removeFirst, removeSecond] = removeEachOther(teamId);
      const firstIsRevoking = new Promise<void>((resolve) => {
        revocationStarted = resolve;
      });

      const first = removeFirst();
      await firstIsRevoking;
      revocationStarted = () => undefined;
      const outcomes = await Promise.allSettled([first, removeSecond()]);

      await expectExactlyOneRefusedAndOneAdminLeft(teamId, outcomes);
    });
  });
});
