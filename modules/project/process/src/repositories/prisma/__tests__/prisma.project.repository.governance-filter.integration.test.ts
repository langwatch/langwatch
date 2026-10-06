import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * @vitest-environment node
 * The project lists a user reads leave out the hidden governance project, over real rows.
 * @see specs/ai-gateway/governance/ui-contract.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaProjectRepository } from "../prisma.project.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaProjectRepository project lists over Postgres", () => {
  const ns = `project-gov-filter-${nanoid(8)}`;
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createTestLogger().logger,
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaProjectRepository.create({ prisma });
  const ids = { organization: "", team: "", application: "", governance: "" };

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Org ${ns}`, slug: `org-${ns}` },
    });
    ids.organization = organization.id;
    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `team-${ns}`, organizationId: organization.id },
    });
    ids.team = team.id;
    const base = { teamId: team.id, language: "python", framework: "openai" };
    const application = await prisma.project.create({
      data: { ...base, name: `App ${ns}`, slug: `app-${ns}`, apiKey: `key-app-${ns}` },
    });
    ids.application = application.id;
    const governance = await prisma.project.create({
      data: {
        ...base,
        name: `Governance ${ns}`,
        slug: `governance-${ns}`,
        apiKey: `key-gov-${ns}`,
        kind: "internal_governance",
      },
    });
    ids.governance = governance.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: [ids.application, ids.governance] } } });
    await prisma.team.deleteMany({ where: { id: ids.team } });
    await prisma.organization.deleteMany({ where: { id: ids.organization } });
    await prisma.$disconnect();
  });

  describe("when an organization has an application project and the hidden governance project", () => {
    /** @scenario The hidden Governance Project never appears in any other user-visible Project surface */
    it("lists the organization's projects without the hidden one, and counts only the visible", async () => {
      const page = await repository.listAllByOrganization({
        organizationId: ids.organization,
        page: 1,
        limit: 50,
      });

      expect(page.data.map((project) => project.id)).toEqual([ids.application]);
      expect(page.pagination.total).toBe(1);
    });

    /** @scenario The hidden Governance Project never appears in any other user-visible Project surface */
    it("lists a team's projects without the hidden one", async () => {
      const projects = await repository.findAllByTeam({
        organizationId: ids.organization,
        teamId: ids.team,
      });

      expect(projects.map((project) => project.id)).toEqual([ids.application]);
    });

    /** @scenario The hidden Governance Project never appears in any other user-visible Project surface */
    it("names the projects of the department pickers and usage mails without the hidden one", async () => {
      const departments = await repository.findProjectsWithDepartments({
        organizationId: ids.organization,
      });
      const live = await repository.findLiveNonGovernanceIds(ids.organization);

      expect(departments.map((project) => project.id)).toEqual([ids.application]);
      expect(live).toEqual([ids.application]);
    });
  });
});
