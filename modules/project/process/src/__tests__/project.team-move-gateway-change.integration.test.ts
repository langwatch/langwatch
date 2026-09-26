/**
 * @vitest-environment node
 * A team move re-resolves the gateway budgets of the keys tracing to the moved
 * project: the move appends to the change feed the gateway long-polls.
 * @see specs/ai-gateway/per-team-budget-reorganization.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { TeamNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaProjectRepository } from "../repositories/prisma/prisma.project.repository.ts";
import type { ProjectCredentials } from "../services/project-credentials.service.ts";
import { ProjectService } from "../services/project.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const testNamespace = `team-move-${nanoid(8)}`;

const credentials: ProjectCredentials = {
  generateProjectId: () => `${testNamespace}-${nanoid(10)}`,
  generateApiKey: () => `sk-lw-test-${nanoid(16)}`,
};

describe.skipIf(!DB_URL)("given a project in one of two teams of an organization", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createTestLogger().logger,
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  /** The one Organization read a move makes: the destination team, live, in the organization. */
  const organizations = createApiFixture<OrganizationApi>({
    getTeam: async ({ teamId, organizationId }) => {
      const team = await prisma.team.findFirst({
        where: { id: teamId, organizationId, archivedAt: null },
      });
      if (!team) throw new TeamNotFoundError(teamId);
      return team;
    },
  });
  const projects = ProjectService.create({
    repository: PrismaProjectRepository.create({ prisma }),
    credentials,
    organizations,
  });

  let organizationId: string;
  let platformTeamId: string;
  let paymentsTeamId: string;
  let projectId: string;

  const changeEvents = () =>
    prisma.gatewayChangeEvent.findMany({
      where: { organizationId, projectId },
      select: { kind: true, projectId: true, payload: true },
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    platformTeamId = (
      await prisma.team.create({
        data: { name: "Platform", slug: `--test-team-${testNamespace}-a`, organizationId },
      })
    ).id;
    paymentsTeamId = (
      await prisma.team.create({
        data: { name: "Payments", slug: `--test-team-${testNamespace}-b`, organizationId },
      })
    ).id;
  });

  beforeEach(async () => {
    projectId = (
      await prisma.project.create({
        data: {
          name: "Checkout",
          slug: `--test-proj-${testNamespace}-${nanoid(6)}`,
          apiKey: `sk-lw-test-${nanoid(16)}`,
          teamId: platformTeamId,
          language: "en",
          framework: "test",
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (!organizationId) return;
    await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({
      where: { teamId: { in: [platformTeamId, paymentsTeamId] } },
    });
    await cleanupTestRows(prisma, [
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
    ]);
    await prisma.$disconnect();
  });

  describe("when the project is moved to the other team", () => {
    /** @scenario A team move tells the gateway to re-resolve the moved project's keys */
    it("moves the project and records one gateway change for it", async () => {
      const moved = await projects.update({
        id: projectId,
        organizationId,
        data: { teamId: paymentsTeamId },
      });

      expect(moved.teamId).toBe(paymentsTeamId);
      await expect(changeEvents()).resolves.toEqual([
        {
          kind: "BUDGET_UPDATED",
          projectId,
          payload: {
            projectTeamMoved: { fromTeamId: platformTeamId, toTeamId: paymentsTeamId },
          },
        },
      ]);
    });
  });

  describe("when the project is renamed", () => {
    /** @scenario An update that keeps the team records no gateway change */
    it("records no gateway change", async () => {
      await projects.update({ id: projectId, organizationId, data: { name: "Checkout v2" } });

      await expect(changeEvents()).resolves.toEqual([]);
    });
  });

  describe("when the update names the team the project already has", () => {
    /** @scenario An update that keeps the team records no gateway change */
    it("records no gateway change", async () => {
      await projects.update({ id: projectId, organizationId, data: { teamId: platformTeamId } });

      await expect(changeEvents()).resolves.toEqual([]);
    });
  });

  describe("when the destination team is archived or belongs to another organization", () => {
    /** @scenario A move to a team outside the organization or archived is refused */
    it("refuses the move, keeps the project in its team and records no gateway change", async () => {
      const archivedTeamId = (
        await prisma.team.create({
          data: {
            name: "Old",
            slug: `--test-team-${testNamespace}-${nanoid(6)}`,
            organizationId,
            archivedAt: new Date(),
          },
        })
      ).id;
      const otherOrganizationId = (
        await prisma.organization.create({
          data: { name: `Other ${testNamespace}`, slug: `--test-org-${testNamespace}-other` },
        })
      ).id;
      const foreignTeamId = (
        await prisma.team.create({
          data: {
            name: "Foreign",
            slug: `--test-team-${testNamespace}-${nanoid(6)}`,
            organizationId: otherOrganizationId,
          },
        })
      ).id;

      try {
        for (const teamId of [archivedTeamId, foreignTeamId]) {
          await expect(
            projects.update({ id: projectId, organizationId, data: { teamId } }),
          ).rejects.toMatchObject({ code: "project_destination_team_not_found" });
        }

        await expect(
          prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true } }),
        ).resolves.toEqual({ teamId: platformTeamId });
        await expect(changeEvents()).resolves.toEqual([]);
      } finally {
        await prisma.team.deleteMany({ where: { id: { in: [archivedTeamId, foreignTeamId] } } });
        await cleanupTestRows(prisma, [["organization", { id: otherOrganizationId }]]);
      }
    });
  });

  describe("when the destination team is someone's personal workspace", () => {
    /** @scenario A move across the personal workspace boundary is refused */
    it("refuses the move across the personal workspace boundary", async () => {
      const personalTeamId = (
        await prisma.team.create({
          data: {
            name: "Someone's Workspace",
            slug: `--test-team-${testNamespace}-${nanoid(6)}`,
            organizationId,
            isPersonal: true,
          },
        })
      ).id;

      await expect(
        projects.update({ id: projectId, organizationId, data: { teamId: personalTeamId } }),
      ).rejects.toMatchObject({ code: "personal_workspace_boundary" });
      await expect(changeEvents()).resolves.toEqual([]);
    });
  });

  describe("when the move names a project of another organization", () => {
    it("refuses it as not found and records no gateway change", async () => {
      await expect(
        projects.update({
          id: projectId,
          organizationId: "some-other-organization",
          data: { teamId: paymentsTeamId },
        }),
      ).rejects.toMatchObject({ code: "project_destination_team_not_found" });

      await expect(changeEvents()).resolves.toEqual([]);
    });
  });
});
