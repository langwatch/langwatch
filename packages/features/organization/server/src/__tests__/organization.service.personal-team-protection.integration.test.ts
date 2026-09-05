/**
 * A personal workspace is one team with exactly one member, its owner, and it cannot be archived: the uniqueness of one personal team per (organization, owner) covers archived rows while the provisioning lookup skips them, so an archived workspace holds the owner's only slot and nothing can hand it back.
 * @vitest-environment node
 * @see specs/ai-gateway/governance/personal-workspace-integrity.feature
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
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
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

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const passthroughSecrets: OrganizationSettingsSecretPort = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};

/**
 * The personal check runs before any binding is written, so a writer that
 * records nothing still proves the refusal — and would fail loudly on the
 * rename path if that path ever started granting.
 */
const noopGrantsWriter = {
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindings: async () => 0,
  revokeBindingsWhere: async () => 0,
} as unknown as AuthzGrantsService;

const unusedAuthz = {} as AuthzService;

describe.skipIf(!DB_URL)("given a personal workspace in an organization", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  const organizations = OrganizationService.create({
    repository: PrismaOrganizationRepository.create(prisma, passthroughSecrets),
    teams: PrismaTeamRepository.create(prisma),
    groups: PrismaGroupRepository.create(prisma),
    identities: PersonalWorkspaceIdentityAdapter.create(),
    teamIdentities: TeamIdentityAdapter.create(),
    groupIdentities: GroupIdentityAdapter.create(),
    authz: unusedAuthz,
    grants: noopGrantsWriter,
  });

  const testNamespace = `pw-protect-${nanoid(8)}`;
  let organizationId: string;
  let ownerUserId: string;
  let colleagueUserId: string;
  let personalTeamId: string;
  let personalTeamName: string;
  let sharedTeamId: string;

  const personalTeamRow = () =>
    prisma.team.findUnique({
      where: { id: personalTeamId },
      select: { name: true, isPersonal: true, archivedAt: true },
    });

  const teamBindings = (teamId: string) =>
    prisma.roleBinding.findMany({
      where: { organizationId, scopeType: "TEAM", scopeId: teamId },
      select: { userId: true, role: true },
    });

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { name: "Workspace Owner", email: `owner-${testNamespace}@example.com` },
    });
    ownerUserId = owner.id;
    const colleague = await prisma.user.create({
      data: { name: "Colleague", email: `colleague-${testNamespace}@example.com` },
    });
    colleagueUserId = colleague.id;

    const organization = await prisma.organization.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    for (const userId of [ownerUserId, colleagueUserId]) {
      await prisma.organizationUser.create({
        data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
      });
    }

    personalTeamName = "Workspace Owner's Workspace";
    const personalTeam = await prisma.team.create({
      data: {
        name: personalTeamName,
        slug: `--test-team-${testNamespace}-personal`,
        organizationId,
        isPersonal: true,
        ownerUserId,
      },
    });
    personalTeamId = personalTeam.id;
    await prisma.project.create({
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
    await prisma.roleBinding.create({
      data: {
        userId: ownerUserId,
        organizationId,
        role: "ADMIN",
        scopeType: "TEAM",
        scopeId: personalTeamId,
      },
    });

    const sharedTeam = await prisma.team.create({
      data: {
        name: `ACME ${testNamespace}`,
        slug: `--test-team-${testNamespace}-shared`,
        organizationId,
      },
    });
    sharedTeamId = sharedTeam.id;
  });

  afterAll(async () => {
    if (!organizationId) return;
    const teams = await prisma.team.findMany({
      where: { organizationId },
      select: { id: true },
    });
    const teamIds = teams.map((team) => team.id);
    await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.teamUser.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, colleagueUserId] } } });
    await prisma.$disconnect();
  });

  describe("when the owner adds a colleague to the personal team", () => {
    const addColleague = () =>
      organizations.addTeamMember({
        organizationId,
        teamId: personalTeamId,
        userId: colleagueUserId,
        role: "MEMBER",
        actor: { type: "user", id: ownerUserId },
      });

    /** @scenario Adding a member to a personal team is refused */
    it("refuses the membership change", async () => {
      await expect(addColleague()).rejects.toMatchObject({
        code: "personal_workspace_not_managed_here",
      });
    });

    /** @scenario Adding a member to a personal team is refused */
    it("leaves the personal team holding its owner alone", async () => {
      await expect(addColleague()).rejects.toThrow();

      await expect(teamBindings(personalTeamId)).resolves.toEqual([
        { userId: ownerUserId, role: "ADMIN" },
      ]);
    });

    /** @scenario Adding a member to a personal team is refused */
    it("does not turn the workspace into an ordinary shared team", async () => {
      await expect(addColleague()).rejects.toThrow();

      await expect(personalTeamRow()).resolves.toMatchObject({ isPersonal: true });
    });
  });

  describe("when the owner archives the personal team", () => {
    const archive = () => organizations.archiveTeam({ organizationId, teamId: personalTeamId });

    /** @scenario Archiving a personal team is refused */
    it("refuses the archival", async () => {
      await expect(archive()).rejects.toMatchObject({
        code: "personal_workspace_not_managed_here",
      });
    });

    /** @scenario Archiving a personal team is refused */
    it("leaves the team unarchived", async () => {
      await expect(archive()).rejects.toThrow();

      await expect(personalTeamRow()).resolves.toMatchObject({ archivedAt: null });
    });

    /** @scenario Archiving a personal team is refused */
    it("leaves provisioning able to find the workspace it would have orphaned", async () => {
      await expect(archive()).rejects.toThrow();

      // The lookup provisioning uses on the next login: an archived team keeps
      // the one slot per (organization, owner), so an invisible row here is a
      // workspace the owner never gets back.
      await expect(
        prisma.team.findFirst({
          where: { organizationId, ownerUserId, isPersonal: true, archivedAt: null },
          select: { id: true },
        }),
      ).resolves.toEqual({ id: personalTeamId });
    });

    it("still archives a shared team, because only personal ones are held back", async () => {
      await expect(
        organizations.archiveTeam({ organizationId, teamId: sharedTeamId }),
      ).resolves.toMatchObject({ id: sharedTeamId });

      await expect(
        prisma.team.findUnique({ where: { id: sharedTeamId }, select: { archivedAt: true } }),
      ).resolves.toMatchObject({ archivedAt: expect.any(Date) });
    });
  });

  describe("when the owner renames the personal team", () => {
    /** @scenario Renaming a personal team is still allowed */
    it("still lets the owner rename their own workspace", async () => {
      const renamed = `${personalTeamName} (renamed)`;

      await expect(
        organizations.updateTeam({ organizationId, teamId: personalTeamId, name: renamed }),
      ).resolves.toMatchObject({ id: personalTeamId, name: renamed });

      await expect(personalTeamRow()).resolves.toMatchObject({
        name: renamed,
        isPersonal: true,
        archivedAt: null,
      });

      await organizations.updateTeam({
        organizationId,
        teamId: personalTeamId,
        name: personalTeamName,
      });
    });
  });
});
