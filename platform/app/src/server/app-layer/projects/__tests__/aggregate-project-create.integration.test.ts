/**
 * @vitest-environment node
 *
 * ADR-144 block D: an organisation admin creates an aggregate project through
 * the ordinary new-project mutation, and its stored rule decides the members.
 * Real Postgres and the real permission engine: the claims are about what is
 * written and who may write it, not about which method was called.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { AGGREGATE_DEFAULT_RULE, aggregateRuleSchema } from "../aggregate-rule";
import { AggregateRuleService } from "../aggregate-rule.service";
import { AGGREGATE_PROJECT_KIND } from "../project-kinds";
import { PrismaAggregateRuleRepository } from "../repositories/aggregate-rule.prisma.repository";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

const rules = new AggregateRuleService(
  new PrismaAggregateRuleRepository(prisma),
);

describe("Feature: an admin creates an aggregate project", () => {
  let fixture: AggregateFixture;

  const createAggregate = async (
    input: Partial<
      Parameters<ReturnType<typeof callerFor>["project"]["create"]>[0]
    > = {},
  ) => {
    const { projectSlug } = await callerFor(fixture.admin.id).project.create({
      organizationId: fixture.organizationId,
      teamId: fixture.team.id,
      name: `Company view ${Math.random().toString(36).slice(2, 8)}`,
      language: "other",
      framework: "other",
      kind: AGGREGATE_PROJECT_KIND,
      ...input,
    });
    return prisma.project.findFirstOrThrow({
      where: { slug: projectSlug, teamId: fixture.team.id },
    });
  };

  const membersOf = async (project: { id: string; aggregateRule: unknown }) =>
    rules.membersOf({
      rule: aggregateRuleSchema.parse(project.aggregateRule),
      organizationId: fixture.organizationId,
      aggregateProjectId: project.id,
    });

  beforeAll(async () => {
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
    });
    fixture = await seedAggregateOrganization(prisma, { label: "agg-create" });
  });

  afterAll(async () => {
    await resetApp();
    await fixture?.cleanup();
  });

  /** @scenario "An admin creates an aggregate project from the new-project flow" */
  describe("when the admin creates a project of kind aggregate without a rule", () => {
    it("stores the all-personal rule and attaches the project to the chosen team", async () => {
      const aggregate = await createAggregate();

      expect(aggregate.kind).toBe(AGGREGATE_PROJECT_KIND);
      expect(aggregate.aggregateRule).toEqual(AGGREGATE_DEFAULT_RULE);
      expect(aggregate.teamId).toBe(fixture.team.id);
      expect(await membersOf(aggregate)).toEqual(
        [fixture.personal.engineer.id, fixture.personal.seller.id].sort(),
      );
    });
  });

  /** @scenario "An admin creates an aggregate project from the new-project flow" */
  describe("when a member who is not an admin asks to create one on their own team", () => {
    it("is refused and nothing is written", async () => {
      const before = await prisma.project.count({
        where: { teamId: fixture.team.id },
      });

      await expect(
        callerFor(fixture.member.id).project.create({
          organizationId: fixture.organizationId,
          teamId: fixture.team.id,
          name: "Sneaky view",
          language: "other",
          framework: "other",
          kind: AGGREGATE_PROJECT_KIND,
        }),
      ).rejects.toThrow();

      expect(
        await prisma.project.count({ where: { teamId: fixture.team.id } }),
      ).toBe(before);
    });
  });

  /** @scenario "The rule may be narrowed to one department" */
  describe("when the admin narrows the rule to the Engineering department", () => {
    it("reads only personal projects whose owner is in Engineering today", async () => {
      const aggregate = await createAggregate({
        aggregateRule: {
          kind: "personal-by-department",
          departmentId: fixture.departments.engineering.id,
        },
      });

      expect(await membersOf(aggregate)).toEqual([
        fixture.personal.engineer.id,
      ]);
    });

    it("follows the owner's current department, not where they were", async () => {
      const aggregate = await createAggregate({
        aggregateRule: {
          kind: "personal-by-department",
          departmentId: fixture.departments.engineering.id,
        },
      });
      await prisma.organizationUser.update({
        where: {
          userId_organizationId: {
            userId: fixture.seller.id,
            organizationId: fixture.organizationId,
          },
        },
        data: { departmentId: fixture.departments.engineering.id },
      });

      try {
        expect(await membersOf(aggregate)).toEqual(
          [fixture.personal.engineer.id, fixture.personal.seller.id].sort(),
        );
      } finally {
        await prisma.organizationUser.update({
          where: {
            userId_organizationId: {
              userId: fixture.seller.id,
              organizationId: fixture.organizationId,
            },
          },
          data: { departmentId: fixture.departments.sales.id },
        });
      }
    });
  });

  /** @scenario "The rule may name an explicit list of any projects" */
  describe("when the admin names an explicit list of two projects", () => {
    it("reads exactly those two, one of which is not personal", async () => {
      const aggregate = await createAggregate({
        aggregateRule: {
          kind: "explicit",
          projectIds: [fixture.shared.id, fixture.personal.seller.id],
        },
      });

      expect(await membersOf(aggregate)).toEqual(
        [fixture.shared.id, fixture.personal.seller.id].sort(),
      );
    });

    it("refuses a list that names the hidden governance project and writes nothing", async () => {
      const before = await prisma.project.count({
        where: { teamId: fixture.team.id },
      });

      await expect(
        createAggregate({
          aggregateRule: {
            kind: "explicit",
            projectIds: [fixture.shared.id, fixture.governance.id],
          },
        }),
      ).rejects.toMatchObject({
        cause: { code: "aggregate_rule_outside_organization" },
      });

      expect(
        await prisma.project.count({ where: { teamId: fixture.team.id } }),
      ).toBe(before);
    });
  });

  /** ADR-144 gate: the migration's documented down path is a statement that
   *  runs. Executed through psql inside one transaction that is rolled back,
   *  so the column is there again for every other suite. */
  describe("when the aggregate rule migration is rolled back by hand", () => {
    it("drops the column by the documented down path and keeps every row", async () => {
      const aggregate = await createAggregate();
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl)
        throw new Error("DATABASE_URL is not set for this suite");

      const output = execFileSync(
        "psql",
        [
          databaseUrl,
          "-v",
          "ON_ERROR_STOP=1",
          "-tA",
          "-c",
          [
            "BEGIN;",
            'ALTER TABLE "Project" DROP COLUMN "aggregateRule";',
            "SELECT count(*) FROM information_schema.columns WHERE table_name = 'Project' AND column_name = 'aggregateRule';",
            "ROLLBACK;",
          ].join(" "),
        ],
        { encoding: "utf8" },
      );

      expect(output.trim().split("\n")).toContain("0");
      const after = await prisma.project.findUniqueOrThrow({
        where: { id: aggregate.id },
        select: { aggregateRule: true },
      });
      expect(after.aggregateRule).toEqual(AGGREGATE_DEFAULT_RULE);
    });
  });
});
