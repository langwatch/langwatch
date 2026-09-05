/**
 * The one write in the personal-workspace suite that has to succeed.
 * @vitest-environment node
 * @see specs/ai-gateway/governance/personal-workspace-integrity.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { OrganizationMembershipService } from "../services/organization-membership.service";
import { PrismaOrganizationMembershipRepository } from "../repositories/prisma/prisma.organization-membership.repository";
import type {
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
} from "../ports/organization-membership.port";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

interface RecordedRoleChange {
  bindingId: string;
  role: string;
}

/** The corrections the seat change asked the ledger for, in order. */
const roleChanges: RecordedRoleChange[] = [];

const recordingGrantsWriter = {
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindings: async () => {},
  revokeBindingsWhere: async () => 0,
  changeBindingRole: async ({ bindingId, role }: { bindingId: string; role: string }) => {
    roleChanges.push({ bindingId, role });
  },
} as unknown as AuthzGrantsService;

const seats = {
  checkLimit: vi.fn(),
  assertRoleChangeAllowed: vi.fn(),
} as unknown as OrganizationSeatLicensePort;
const sessions = {
  revokeAllBrowserSessions: vi.fn(),
} as unknown as OrganizationSessionRevocationPort;
const grantCache = {
  invalidateOrganization: vi.fn(),
} as unknown as OrganizationGrantCachePort;
const prompts = {
  seedTagsForOrganization: vi.fn(),
  reportCompensationFailure: vi.fn(),
} as unknown as OrganizationPromptSeedPort;

describe.skipIf(!DB_URL)(
  "given a member with a personal workspace who also administers a shared team",
  () => {
    const connection: PrismaConnection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client as PrismaClient;
    const memberships = OrganizationMembershipService.create({
      repository: PrismaOrganizationMembershipRepository.create({
        database: prisma,
        grants: recordingGrantsWriter,
      }),
      prompts,
      seats,
      sessions,
      grantCache,
    });

    const testNamespace = `pw-seat-${nanoid(8)}`;
    let organizationId: string;
    let adminUserId: string;
    let seatUserId: string;
    let personalTeamId: string;
    let personalProjectId: string;
    let sharedTeamId: string;
    let personalBindingId: string;
    let sharedBindingId: string;

    const organizationRoleOfSeatUser = async () =>
      (
        await prisma.organizationUser.findUniqueOrThrow({
          where: { userId_organizationId: { userId: seatUserId, organizationId } },
          select: { role: true },
        })
      ).role;

    beforeAll(async () => {
      const admin = await prisma.user.create({
        data: { name: "Admin", email: `admin-${testNamespace}@example.com` },
      });
      adminUserId = admin.id;
      const seatUser = await prisma.user.create({
        data: { name: "Seat User", email: `seat-${testNamespace}@example.com` },
      });
      seatUserId = seatUser.id;

      const organization = await prisma.organization.create({
        data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
      });
      organizationId = organization.id;

      // Two organization admins, so demoting the seat user is not refused for
      // being the last one.
      await prisma.organizationUser.createMany({
        data: [
          { userId: adminUserId, organizationId, role: OrganizationUserRole.ADMIN },
          { userId: seatUserId, organizationId, role: OrganizationUserRole.ADMIN },
        ],
      });

      const personalTeam = await prisma.team.create({
        data: {
          name: "Seat User's Workspace",
          slug: `--test-team-${testNamespace}-personal`,
          organizationId,
          isPersonal: true,
          ownerUserId: seatUserId,
        },
      });
      personalTeamId = personalTeam.id;

      const personalProject = await prisma.project.create({
        data: {
          name: "Personal",
          slug: `--test-proj-${testNamespace}-personal`,
          apiKey: `sk-lw-test-${nanoid(16)}`,
          teamId: personalTeamId,
          language: "en",
          framework: "test",
          isPersonal: true,
        },
      });
      personalProjectId = personalProject.id;

      const sharedTeam = await prisma.team.create({
        data: {
          name: `ACME ${testNamespace}`,
          slug: `--test-team-${testNamespace}-shared`,
          organizationId,
        },
      });
      sharedTeamId = sharedTeam.id;

      const personalBinding = await prisma.roleBinding.create({
        data: {
          userId: seatUserId,
          organizationId,
          role: "ADMIN",
          scopeType: "TEAM",
          scopeId: personalTeamId,
        },
      });
      personalBindingId = personalBinding.id;

      // Admin of the team the organization shares — the binding the downgrade
      // is supposed to correct. The other admin administers it too, so
      // correcting this one does not strand the team.
      const sharedBinding = await prisma.roleBinding.create({
        data: {
          userId: seatUserId,
          organizationId,
          role: "ADMIN",
          scopeType: "TEAM",
          scopeId: sharedTeamId,
        },
      });
      sharedBindingId = sharedBinding.id;
      await prisma.roleBinding.create({
        data: {
          userId: adminUserId,
          organizationId,
          role: "ADMIN",
          scopeType: "TEAM",
          scopeId: sharedTeamId,
        },
      });
    });

    afterAll(async () => {
      if (!organizationId) return;
      await prisma.project.deleteMany({ where: { team: { organizationId } } });
      await prisma.roleBinding.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: { in: [adminUserId, seatUserId] } } });
      await prisma.$disconnect();
    });

    describe("when an admin moves them to a Lite Member seat", () => {
      beforeAll(async () => {
        roleChanges.length = 0;
        await memberships.changeMemberRole({
          organizationId,
          userId: seatUserId,
          role: OrganizationUserRole.EXTERNAL,
          currentUserId: adminUserId,
        });
      });

      /** @scenario Moving a member who has a personal workspace to Lite Member succeeds */
      it("changes the organization role", async () => {
        await expect(organizationRoleOfSeatUser()).resolves.toBe(OrganizationUserRole.EXTERNAL);
      });

      /** @scenario Moving a member who has a personal workspace to Lite Member succeeds */
      it("corrects their role on the shared team to viewer", () => {
        expect(roleChanges).toContainEqual({ bindingId: sharedBindingId, role: "VIEWER" });
      });

      /** @scenario Moving a member who has a personal workspace to Lite Member succeeds */
      it("leaves them the admin of their own workspace", async () => {
        expect(roleChanges.map((change) => change.bindingId)).not.toContain(personalBindingId);

        await expect(
          prisma.roleBinding.findUniqueOrThrow({
            where: { id: personalBindingId },
            select: { role: true },
          }),
        ).resolves.toMatchObject({ role: "ADMIN" });
      });

      /** @scenario Moving a member who has a personal workspace to Lite Member succeeds */
      it("leaves the workspace where their next login finds it", async () => {
        // The lookup provisioning uses: an archived or project-less team here
        // is a workspace the owner never gets back.
        await expect(
          prisma.team.findFirst({
            where: {
              organizationId,
              ownerUserId: seatUserId,
              isPersonal: true,
              archivedAt: null,
            },
            select: { id: true, projects: { where: { archivedAt: null }, select: { id: true } } },
          }),
        ).resolves.toEqual({
          id: personalTeamId,
          projects: [{ id: personalProjectId }],
        });
      });
    });
  },
);
