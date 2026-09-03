/**
 * @vitest-environment node
 *
 * @see specs/ai-gateway/governance/personal-workspace-integrity.feature
 *
 * When a personal workspace goes, and what happens if its owner comes back.
 *
 * Moved from `personal-workspace-lifecycle.integration.test.ts` on
 * platform/app. That file drove the whole path through the deleted
 * `appRouter` and the deleted `PersonalWorkspaceService`; the two halves of
 * the behaviour it tested both live in this package now —
 * `PrismaOrganizationMembershipRepository.deleteMember` archives the
 * personal team and project on removal, and
 * `PrismaOrganizationRepository.ensurePersonalWorkspace` recognises and
 * revives an archived workspace on the next `ensure`. The RBAC re-grant
 * assertion (`hasProjectPermission`) does not travel: it belongs to the
 * authz package now, not this one.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the
 * suite stays runnable on a box with no database.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { PersonalWorkspaceIdentityAdapter } from "../../../adapters/resource-identifiers.adapter";
import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository";
import { PrismaOrganizationRepository } from "../prisma.organization.repository";
import type { OrganizationSettingsSecretPort } from "../../../ports/organization.port";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const noopGrantsWriter = {
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
} as unknown as AuthzGrantsService;

const passthroughSecrets: OrganizationSettingsSecretPort = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};

describe.skipIf(!DB_URL)("given a member with a personal workspace in an organization", () => {
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient | undefined;
  let membershipRepository: PrismaOrganizationMembershipRepository;
  let organizationRepository: PrismaOrganizationRepository;
  const identities = PersonalWorkspaceIdentityAdapter.create();
  const testNamespace = `pw-lifecycle-${nanoid(8)}`;

  let organizationId: string;
  let leaverUserId: string;
  let personalTeamId: string;
  let personalProjectId: string;

  connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  prisma = connection.client as PrismaClient;
  membershipRepository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: noopGrantsWriter,
  });
  organizationRepository = PrismaOrganizationRepository.create(prisma, passthroughSecrets);

  async function ensureLeaverWorkspace() {
    const resources = identities.create({ userId: leaverUserId, organizationId });
    return organizationRepository.ensurePersonalWorkspace({
      workspace: { userId: leaverUserId, organizationId, displayName: "Leaver" },
      resources,
    });
  }

  const workspaceRows = () =>
    prisma!.team.findUnique({
      where: { id: personalTeamId },
      select: { archivedAt: true, projects: { select: { id: true, archivedAt: true } } },
    });

  beforeAll(async () => {
    const leaver = await prisma!.user.create({
      data: { name: "Leaver", email: `leaver-${testNamespace}@example.com` },
    });
    leaverUserId = leaver.id;

    const organization = await prisma!.organization.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    await prisma!.organizationUser.create({
      data: { userId: leaverUserId, organizationId, role: OrganizationUserRole.MEMBER },
    });

    const workspace = await ensureLeaverWorkspace();
    personalTeamId = workspace.workspace.team.id;
    personalProjectId = workspace.workspace.project.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { teamId: personalTeamId } });
    await prisma.teamUser.deleteMany({ where: { teamId: personalTeamId } });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: leaverUserId } });
    await prisma.$disconnect();
  });

  describe("when an admin removes that member from the organization", () => {
    beforeAll(async () => {
      await membershipRepository.deleteMember({ organizationId, userId: leaverUserId });
    });

    /** @scenario Removing a member takes their personal workspace with them */
    it("archives the workspace team", async () => {
      await expect(workspaceRows()).resolves.toMatchObject({ archivedAt: expect.any(Date) });
    });

    /** @scenario Removing a member takes their personal workspace with them */
    it("archives its project with it", async () => {
      const rows = await workspaceRows();
      expect(rows?.projects).toEqual([{ id: personalProjectId, archivedAt: expect.any(Date) }]);
    });

    /** @scenario Removing a member takes their personal workspace with them */
    it("leaves nothing an admin still has to clean up", async () => {
      await expect(
        prisma!.team.findFirst({
          where: {
            organizationId,
            ownerUserId: leaverUserId,
            isPersonal: true,
            archivedAt: null,
          },
        }),
      ).resolves.toBeNull();
    });

    describe("when that member joins the organization again", () => {
      beforeAll(async () => {
        await prisma!.organizationUser.create({
          data: { userId: leaverUserId, organizationId, role: OrganizationUserRole.MEMBER },
        });
      });

      /** @scenario Inviting a removed member back gives them their workspace again */
      it("hands back the same workspace rather than a new one", async () => {
        const result = await ensureLeaverWorkspace();

        expect(result.created).toBe(false);
        expect(result.workspace.team.id).toBe(personalTeamId);
        expect(result.workspace.project.id).toBe(personalProjectId);
      });

      /** @scenario Inviting a removed member back gives them their workspace again */
      it("clears the archived-at stamp on revival", async () => {
        await ensureLeaverWorkspace();

        await expect(workspaceRows()).resolves.toMatchObject({ archivedAt: null });
      });
    });
  });
});
