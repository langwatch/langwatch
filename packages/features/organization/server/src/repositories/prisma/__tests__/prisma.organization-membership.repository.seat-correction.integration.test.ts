/**
 * What a seat correction reaches, and what it reports back.
 *
 * Moving someone to a Lite Member seat caps every scope the seat caps — team
 * roles and project access alike — and a team that loses its only admin to that
 * correction is named back to the person who made it rather than silently left
 * headless.
 * @vitest-environment node
 * @see specs/members/member-role-team-restrictions.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/prisma-client/generated";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

/**
 * The ledger the corrections are commanded through. Recording rather than
 * real: a binding's role is changed by the grant ledger, and what this
 * repository decides is WHICH bindings to command and to what — which is the
 * half the seat correction owns.
 */
type RoleChange = { bindingId: string; role: string; customRoleId: string | null };

function recordingGrantsWriter() {
  const changes: RoleChange[] = [];
  const writer = {
    attachBindings: async () => ({ attached: [], duplicates: [] }),
    revokeBindings: async () => ({ revoked: 0 }),
    revokeBindingsWhere: async () => 0,
    changeBindingRole: async (input: RoleChange) => {
      changes.push({
        bindingId: input.bindingId,
        role: input.role,
        customRoleId: input.customRoleId ?? null,
      });
      return { changed: true };
    },
  } as unknown as AuthzGrantsService;
  return { writer, changes };
}

const grants = recordingGrantsWriter();

describe.skipIf(!DB_URL)(
  "PrismaOrganizationMembershipRepository.updateMemberRole — the seat correction",
  () => {
    const suffix = nanoid(8);
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client as PrismaClient;
    const repository = PrismaOrganizationMembershipRepository.create({
      database: prisma,
      grants: grants.writer,
    });

    let organizationId: string;
    let adminUserId: string;
    let memberUserId: string;
    let soloAdminTeamId: string;
    let sharedTeamId: string;
    let sharedProjectId: string;
    let personalProjectId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: "Seat Correction Org", slug: `--test-org-${suffix}` },
      });
      organizationId = organization.id;

      const admin = await prisma.user.create({
        data: { name: "Admin", email: `admin-${suffix}@example.com` },
      });
      adminUserId = admin.id;
      const member = await prisma.user.create({
        data: { name: "Member", email: `member-${suffix}@example.com` },
      });
      memberUserId = member.id;

      await prisma.organizationUser.createMany({
        data: [
          { userId: adminUserId, organizationId, role: OrganizationUserRole.ADMIN },
          { userId: memberUserId, organizationId, role: OrganizationUserRole.MEMBER },
        ],
      });

      const soloAdminTeam = await prisma.team.create({
        data: { name: "Solo Admin Team", slug: `--test-team-solo-${suffix}`, organizationId },
      });
      soloAdminTeamId = soloAdminTeam.id;
      const sharedTeam = await prisma.team.create({
        data: { name: "Shared Team", slug: `--test-team-shared-${suffix}`, organizationId },
      });
      sharedTeamId = sharedTeam.id;

      const sharedProject = await prisma.project.create({
        data: {
          name: "Shared Project",
          slug: `--test-project-shared-${suffix}`,
          teamId: sharedTeamId,
          language: "en",
          framework: "other",
          apiKey: `test-key-shared-${suffix}`,
        },
      });
      sharedProjectId = sharedProject.id;

      const personalTeam = await prisma.team.create({
        data: {
          name: "Member's workspace",
          slug: `--test-team-personal-${suffix}`,
          organizationId,
          isPersonal: true,
        },
      });
      const personalProject = await prisma.project.create({
        data: {
          name: "Member's project",
          slug: `--test-project-personal-${suffix}`,
          teamId: personalTeam.id,
          language: "en",
          framework: "other",
          apiKey: `test-key-personal-${suffix}`,
          isPersonal: true,
        },
      });
      personalProjectId = personalProject.id;

      await prisma.roleBinding.createMany({
        data: [
          {
            organizationId,
            userId: memberUserId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: soloAdminTeamId,
            role: TeamUserRole.ADMIN,
          },
          {
            organizationId,
            userId: memberUserId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: sharedTeamId,
            role: TeamUserRole.ADMIN,
          },
          {
            organizationId,
            userId: adminUserId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: sharedTeamId,
            role: TeamUserRole.ADMIN,
          },
          {
            organizationId,
            userId: memberUserId,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: sharedProjectId,
            role: TeamUserRole.ADMIN,
          },
          {
            organizationId,
            userId: memberUserId,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: personalProjectId,
            role: TeamUserRole.ADMIN,
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma.roleBinding.deleteMany({ where: { organizationId } });
      await prisma.project.deleteMany({ where: { team: { organizationId } } });
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: { in: [adminUserId, memberUserId] } } });
      await prisma.$disconnect();
    });

    /** The role the correction commanded on one scope, if it commanded any. */
    const commandedRoleOn = async (scopeType: RoleBindingScopeType, scopeId: string) => {
      const binding = await prisma.roleBinding.findFirst({
        where: { organizationId, userId: memberUserId, scopeType, scopeId },
        select: { id: true },
      });
      return grants.changes.find((change) => change.bindingId === binding?.id)?.role;
    };

    describe("given a member who administers two teams and a shared project", () => {
      let result: { teamsLeftWithoutAdmin: Array<{ id: string; name: string }> };

      beforeAll(async () => {
        result = await repository.updateMemberRole({
          organizationId,
          userId: memberUserId,
          role: OrganizationUserRole.EXTERNAL,
          effectiveTeamRoleUpdates: [
            { teamId: soloAdminTeamId, role: TeamUserRole.VIEWER, origin: "seat-correction" },
            { teamId: sharedTeamId, role: TeamUserRole.VIEWER, origin: "seat-correction" },
          ],
          currentUserId: adminUserId,
        });
      });

      /** @scenario The teams left without a team admin are named back to the admin */
      it("names the team the correction left headless, and only that one", () => {
        expect(result.teamsLeftWithoutAdmin).toEqual([
          { id: soloAdminTeamId, name: "Solo Admin Team" },
        ]);
      });

      /** @scenario Moving a member to a Lite Member seat corrects their project access rows to Viewer */
      it("caps their access on the shared project at viewer", async () => {
        await expect(commandedRoleOn(RoleBindingScopeType.PROJECT, sharedProjectId)).resolves.toBe(
          TeamUserRole.VIEWER,
        );
      });

      /** @scenario A seat correction leaves the personal workspace access row alone */
      it("commands nothing on their own workspace", async () => {
        await expect(
          commandedRoleOn(RoleBindingScopeType.PROJECT, personalProjectId),
        ).resolves.toBeUndefined();
      });
    });
  },
);
