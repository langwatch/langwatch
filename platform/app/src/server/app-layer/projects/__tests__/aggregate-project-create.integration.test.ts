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
import { roleFactToRow } from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { documentedDownPath } from "~/test-utils/migrationDownPath";
import { KSUID_RESOURCES } from "~/utils/constants";
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

const AGGREGATE_RULE_MIGRATION = "20261006120002_project_aggregate_rule";

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

  describe("when the admin creates a project of kind aggregate without a rule", () => {
    /** @scenario "An admin creates an aggregate project from the new-project flow" */
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

  describe("when a member who is not an admin asks to create one on their own team", () => {
    /** @scenario "A member who is not an admin is refused when creating an aggregate project" */
    it("is refused as admin only with a 403 and nothing is written", async () => {
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
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "aggregate_project_admin_only", httpStatus: 403 },
      });

      expect(
        await prisma.project.count({ where: { teamId: fixture.team.id } }),
      ).toBe(before);
    });
  });

  describe("when someone outside the organisation asks to create one", () => {
    it("keeps the shared permission refusal, not the admin-only one, and writes nothing", async () => {
      // An outsider has no organisation role to judge, so the request is
      // refused by the organisation permission check exactly as before
      // ADR-144, and is never told aggregates are admin only.
      const foreign = await seedAggregateOrganization(prisma, {
        label: "agg-create-outsider",
      });
      try {
        const before = await prisma.project.count({
          where: { teamId: fixture.team.id },
        });

        const refusal = await callerFor(foreign.admin.id)
          .project.create({
            organizationId: fixture.organizationId,
            teamId: fixture.team.id,
            name: "Outsider view",
            language: "other",
            framework: "other",
            kind: AGGREGATE_PROJECT_KIND,
          })
          .then(() => null)
          .catch((error: { code?: string; cause?: { code?: string } }) => ({
            code: error.code,
            causeCode: error.cause?.code,
          }));

        expect(refusal?.code).toBe("UNAUTHORIZED");
        expect(refusal?.causeCode).not.toBe("aggregate_project_admin_only");
        expect(
          await prisma.project.count({ where: { teamId: fixture.team.id } }),
        ).toBe(before);
      } finally {
        await foreign.cleanup();
      }
    });
  });

  describe("when a member whose custom role grants organization:manage asks to create one", () => {
    it("is refused as admin only and nothing is written", async () => {
      // The role passes the organisation permission check, so only the
      // organisation-role rule of ADR-144 decision 5 can refuse this.
      const manager = await fixture.makeUser({
        handle: "org-manager",
        organizationRole: OrganizationUserRole.MEMBER,
      });
      const permissions = ["organization:manage"];
      const customRole = await prisma.customRole.create({
        data: {
          organizationId: fixture.organizationId,
          name: `Organisation manager ${fixture.ns}`,
          permissions,
        },
      });
      await prisma.role.create({
        data: roleFactToRow({
          organizationId: fixture.organizationId,
          role: {
            roleId: customRole.id,
            name: customRole.name,
            permissions,
            kind: "custom",
            occurredAtMs: customRole.createdAt.getTime(),
          },
        }),
      });
      await seedRoleBinding(prisma, {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: fixture.organizationId,
        userId: manager.id,
        role: TeamUserRole.CUSTOM,
        customRoleId: customRole.id,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: fixture.organizationId,
      });
      const before = await prisma.project.count({
        where: { teamId: fixture.team.id },
      });

      await expect(
        callerFor(manager.id).project.create({
          organizationId: fixture.organizationId,
          teamId: fixture.team.id,
          name: "Team admin view",
          language: "other",
          framework: "other",
          kind: AGGREGATE_PROJECT_KIND,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "aggregate_project_admin_only" },
      });

      expect(
        await prisma.project.count({ where: { teamId: fixture.team.id } }),
      ).toBe(before);
    });
  });

  describe("when an admin of two organisations names the other one's team", () => {
    it("is refused and writes no project and no grant", async () => {
      const foreign = await seedAggregateOrganization(prisma, {
        label: "agg-create-foreign-team",
      });
      try {
        // Someone who manages both organisations passes every permission
        // check, so only the team's own organisation can refuse this.
        const dualAdmin = await fixture.makeUser({
          handle: "dual-admin",
          organizationRole: OrganizationUserRole.ADMIN,
        });
        await prisma.organizationUser.create({
          data: {
            userId: dualAdmin.id,
            organizationId: foreign.organizationId,
            role: OrganizationUserRole.ADMIN,
          },
        });
        await seedRoleBinding(prisma, {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: foreign.organizationId,
          userId: dualAdmin.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: foreign.organizationId,
        });
        const sharedReadsIn = (organizationId: string) =>
          prisma.grant.count({
            where: { organizationId, principalType: "PROJECT" },
          });
        const before = {
          projects: await prisma.project.count({
            where: { teamId: foreign.team.id },
          }),
          grants: await sharedReadsIn(foreign.organizationId),
          ownGrants: await sharedReadsIn(fixture.organizationId),
        };

        await expect(
          callerFor(dualAdmin.id).project.create({
            organizationId: fixture.organizationId,
            teamId: foreign.team.id,
            name: "Outsider view",
            language: "other",
            framework: "other",
            kind: AGGREGATE_PROJECT_KIND,
          }),
          // The scope lineage guard refuses ids from two organisations before
          // any permission check, shaped as an ordinary denial so the refusal
          // cannot tell a caller which organisation the team is in.
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect({
          projects: await prisma.project.count({
            where: { teamId: foreign.team.id },
          }),
          grants: await sharedReadsIn(foreign.organizationId),
          ownGrants: await sharedReadsIn(fixture.organizationId),
        }).toEqual(before);
      } finally {
        await foreign.cleanup();
      }
    });
  });

  describe("when the admin narrows the rule to the Engineering department", () => {
    /** @scenario "The rule may be narrowed to one department" */
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

  describe("when the admin names an explicit list of two projects", () => {
    /** @scenario "The rule may name an explicit list of any projects" */
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

    it("refuses a list that names a project in another organisation and writes nothing", async () => {
      const foreign = await seedAggregateOrganization(prisma, {
        label: "agg-create-foreign",
      });
      try {
        const before = await prisma.project.count({
          where: { teamId: fixture.team.id },
        });

        await expect(
          createAggregate({
            aggregateRule: {
              kind: "explicit",
              projectIds: [fixture.shared.id, foreign.shared.id],
            },
          }),
        ).rejects.toMatchObject({
          cause: { code: "aggregate_rule_outside_organization" },
        });

        expect(
          await prisma.project.count({ where: { teamId: fixture.team.id } }),
        ).toBe(before);
      } finally {
        await foreign.cleanup();
      }
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

      const columnCount =
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Project' AND column_name = 'aggregateRule';";
      const output = execFileSync(
        "psql",
        [
          databaseUrl,
          "-v",
          "ON_ERROR_STOP=1",
          "-qtA",
          ...[
            "BEGIN;",
            columnCount,
            documentedDownPath({ migration: AGGREGATE_RULE_MIGRATION }),
            columnCount,
          ].flatMap((statement) => ["-c", statement]),
          "-c",
          "ROLLBACK;",
        ],
        { encoding: "utf8" },
      );

      // Present before, gone after: a filter that matched nothing would
      // read 0 both times.
      expect(output.trim().split("\n")).toEqual(["1", "0"]);
      const after = await prisma.project.findUniqueOrThrow({
        where: { id: aggregate.id },
        select: { aggregateRule: true },
      });
      expect(after.aggregateRule).toEqual(AGGREGATE_DEFAULT_RULE);
    });
  });
});
