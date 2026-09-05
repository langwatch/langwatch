/**
 * @vitest-environment node
 *
 * @see specs/ai-gateway/governance/personal-workspace-integrity.feature
 *
 * A personal workspace is one team holding one project, and the project's own
 * `isPersonal` flag is a denormalized mirror of its team's. Moving a project
 * across that boundary, adding a second project to the workspace, or archiving
 * the one it has would each leave the pair disagreeing or the workspace
 * without the project the provisioning lookup needs, so `ProjectService`
 * refuses all four writes.
 *
 * Ported from `personal-workspace-invariants.integration.test.ts` on
 * platform/app, which drove the deleted `appRouter`. The guard itself moved
 * here: `personalWorkspaceMoveViolation` / `personalWorkspaceCreateViolation`
 * / `personalWorkspaceArchiveViolation` are enforced by this service.
 *
 * Every refusal is asserted twice — the write fails with a code, and the rows
 * it would have produced are proven absent — because a guard that rejects
 * while the damage lands anyway passes a test that only reads the error.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { OrganizationService } from "@langwatch/organization-contract";
import { PrismaProjectRepository } from "../repositories/prisma/prisma.project.repository";
import type { ProjectCredentialsPort } from "../ports/project.port";
import { ProjectService } from "../services/project.service";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const testNamespace = `pw-boundary-${nanoid(8)}`;

/** Deterministic ids, so a leaked row is traceable to this suite. */
const credentials: ProjectCredentialsPort = {
  generateProjectId: () => `${testNamespace}-${nanoid(10)}`,
  generateApiKey: () => `sk-lw-test-${nanoid(16)}`,
};

/**
 * Only the `newTeamName` branch of `create` reaches Organization, and no test
 * here takes it: every case names an existing team.
 */
const unusedOrganizations = {} as OrganizationService;

describe.skipIf(!DB_URL)(
  "given a personal workspace beside a shared team in one organization",
  () => {
    const connection: PrismaConnection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client as PrismaClient;
    const projects = ProjectService.create({
      repository: PrismaProjectRepository.create(prisma),
      credentials,
      organizations: unusedOrganizations,
    });

    let organizationId: string;
    let ownerUserId: string;
    let personalTeamId: string;
    let personalProjectId: string;
    let sharedTeamId: string;
    let sharedProjectId: string;

    const personalProjectRow = () =>
      prisma.project.findUnique({
        where: { id: personalProjectId },
        select: {
          teamId: true,
          isPersonal: true,
          archivedAt: true,
          team: { select: { isPersonal: true } },
        },
      });

    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: { name: "Workspace Owner", email: `owner-${testNamespace}@example.com` },
      });
      ownerUserId = owner.id;

      const organization = await prisma.organization.create({
        data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
      });
      organizationId = organization.id;

      const personalTeam = await prisma.team.create({
        data: {
          name: "Workspace Owner's Workspace",
          slug: `--test-team-${testNamespace}-personal`,
          organizationId,
          isPersonal: true,
          ownerUserId,
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

      const sharedProject = await prisma.project.create({
        data: {
          name: "ACME App",
          slug: `--test-proj-${testNamespace}-shared`,
          apiKey: `sk-lw-test-${nanoid(16)}`,
          teamId: sharedTeamId,
          language: "en",
          framework: "test",
        },
      });
      sharedProjectId = sharedProject.id;
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
      await prisma.user.deleteMany({ where: { id: ownerUserId } });
      await prisma.$disconnect();
    });

    describe("when the owner moves the personal project into the shared team", () => {
      const move = () =>
        projects.update({
          id: personalProjectId,
          organizationId,
          data: { teamId: sharedTeamId },
        });

      /** @scenario Moving a personal project into a shared team is refused */
      it("refuses the move", async () => {
        await expect(move()).rejects.toMatchObject({
          code: "personal_workspace_boundary",
        });
      });

      /** @scenario Moving a personal project into a shared team is refused */
      it("leaves the project in the personal team", async () => {
        await expect(move()).rejects.toThrow();

        await expect(personalProjectRow()).resolves.toMatchObject({
          teamId: personalTeamId,
          archivedAt: null,
        });
      });

      /** @scenario Moving a personal project into a shared team is refused */
      it("leaves the project's own flag agreeing with its team's", async () => {
        await expect(move()).rejects.toThrow();

        // A half-applied move is what leaves the mirrored flags disagreeing,
        // and no reader handles a project that is personal in one place and
        // shared in the other. That disagreement is the corruption refused.
        await expect(personalProjectRow()).resolves.toMatchObject({
          isPersonal: true,
          team: { isPersonal: true },
        });
      });
    });

    describe("when the owner moves a shared project into the personal team", () => {
      const move = () =>
        projects.update({
          id: sharedProjectId,
          organizationId,
          data: { teamId: personalTeamId },
        });

      /** @scenario Moving a real project into a personal workspace is refused */
      it("refuses the move", async () => {
        await expect(move()).rejects.toMatchObject({
          code: "personal_workspace_boundary",
        });
      });

      /** @scenario Moving a real project into a personal workspace is refused */
      it("leaves the project in the shared team, still shared", async () => {
        await expect(move()).rejects.toThrow();

        await expect(
          prisma.project.findUnique({
            where: { id: sharedProjectId },
            select: { teamId: true, isPersonal: true },
          }),
        ).resolves.toMatchObject({ teamId: sharedTeamId, isPersonal: false });
      });
    });

    describe("when the owner creates a second project in their personal team", () => {
      const create = () =>
        projects.create({
          organizationId,
          teamId: personalTeamId,
          name: "Second Personal Project",
          language: "en",
          framework: "test",
        });

      /** @scenario Creating a project in a personal workspace is refused */
      it("refuses the creation", async () => {
        await expect(create()).rejects.toMatchObject({
          code: "personal_workspace_boundary",
        });
      });

      /** @scenario Creating a project in a personal workspace is refused */
      it("leaves the workspace holding exactly its one project", async () => {
        await expect(create()).rejects.toThrow();

        await expect(
          prisma.project.findMany({
            where: { teamId: personalTeamId, archivedAt: null },
            select: { id: true },
          }),
        ).resolves.toEqual([{ id: personalProjectId }]);
      });
    });

    describe("when the owner archives the personal project", () => {
      const archive = () => projects.archive({ id: personalProjectId, organizationId });

      /** @scenario Archiving a personal project is refused */
      it("refuses the archival", async () => {
        await expect(archive()).rejects.toMatchObject({
          code: "personal_project_protected",
        });
      });

      /** @scenario Archiving a personal project is refused */
      it("leaves the workspace where the next login finds it", async () => {
        await expect(archive()).rejects.toThrow();

        await expect(personalProjectRow()).resolves.toMatchObject({
          archivedAt: null,
          teamId: personalTeamId,
        });
      });
    });
  },
);
