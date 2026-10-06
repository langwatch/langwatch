/**
 * @vitest-environment node
 *
 * ADR-144 block E: the reconciler keeps an aggregate's members current. Real
 * Postgres, the real grants pipeline (memory event store, Prisma projection)
 * and the real triggers: each scenario drives the path a person takes, and
 * reads the ledger's Grant rows to see what landed.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrantPrincipalType, GrantScopeType } from "~/generated/prisma/client";
import { NullLwqlKeyMapRepository } from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import {
  GrantsLedgerWriter,
  resetAuthzGrantsCommandsForTests,
} from "~/server/app-layer/authz/ledger";
import { createTestApp } from "~/server/app-layer/presets";
import { PrismaScheduledJobRepository } from "~/server/app-layer/scheduler/scheduled-job.repository";
import { prisma } from "~/server/db";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { AggregateReconciler } from "../aggregate-reconciler.service";
import type { AggregateRule } from "../aggregate-rule";
import { AggregateRuleService } from "../aggregate-rule.service";
import { ProjectService } from "../project.service";
import { AGGREGATE_PROJECT_KIND } from "../project-kinds";
import { PrismaAggregateRuleRepository } from "../repositories/aggregate-rule.prisma.repository";
import { PrismaProjectRepository } from "../repositories/project.prisma.repository";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

const ruleRepository = new PrismaAggregateRuleRepository(prisma);
const rules = new AggregateRuleService(ruleRepository);
const reconciler = new AggregateReconciler({
  aggregates: ruleRepository,
  rules,
  ledger: () => new GrantsLedgerWriter(prisma),
  schedule: new PrismaScheduledJobRepository(prisma),
});

describe("Feature: the reconciler keeps members current", () => {
  let fixture: AggregateFixture;

  /** Every shared-read Grant row the aggregate holds, revoked ones included. */
  const sharedReadRowsOf = (aggregateProjectId: string) =>
    prisma.grant.findMany({
      where: {
        organizationId: fixture.organizationId,
        principalType: GrantPrincipalType.PROJECT,
        principalId: aggregateProjectId,
        scopeType: GrantScopeType.PROJECT,
        roleKey: "project-reader",
      },
      orderBy: { id: "asc" },
    });

  /** The member project ids of the aggregate's live shared reads. */
  const liveMembersOf = async (aggregateProjectId: string) =>
    (await sharedReadRowsOf(aggregateProjectId))
      .filter((row) => row.revokedAt === null)
      .map((row) => row.scopeId)
      .sort();

  /** What an admin does: create an aggregate through the new-project flow. */
  const createAggregate = async (aggregateRule?: AggregateRule) => {
    const { projectSlug } = await callerFor(fixture.admin.id).project.create({
      organizationId: fixture.organizationId,
      teamId: fixture.team.id,
      name: `Company view ${Math.random().toString(36).slice(2, 8)}`,
      language: "other",
      framework: "other",
      kind: AGGREGATE_PROJECT_KIND,
      ...(aggregateRule ? { aggregateRule } : {}),
    });
    return prisma.project.findFirstOrThrow({
      where: { slug: projectSlug, teamId: fixture.team.id },
    });
  };

  beforeAll(async () => {
    resetAuthzGrantsCommandsForTests();
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
      projects: new ProjectService(
        new PrismaProjectRepository(prisma),
        new NullLwqlKeyMapRepository(),
        rules,
        reconciler,
      ),
      _eventSourcing: createAuthzTestEventSourcing(prisma),
    });
    fixture = await seedAggregateOrganization(prisma, {
      label: "agg-reconcile",
    });
  });

  afterAll(async () => {
    try {
      await fixture?.cleanup();
    } finally {
      await resetApp();
      resetAuthzGrantsCommandsForTests();
    }
  });

  /** @scenario "The hidden governance project is never a member" */
  describe("when ana creates an aggregate project with the rule all personal projects", () => {
    it("attaches every personal project and never the hidden governance project", async () => {
      // A governance project that even looks personal: only its kind keeps
      // it out, so this fails if the kind filter goes.
      const personalTeam = await prisma.team.create({
        data: {
          name: `governance workspace ${fixture.ns}`,
          slug: `--test-governance-personal-${fixture.ns}`,
          organizationId: fixture.organizationId,
          isPersonal: true,
          ownerUserId: fixture.member.id,
        },
      });
      const personalLookingGovernance = await prisma.project.create({
        data: {
          name: `Governance personal ${fixture.ns}`,
          slug: `--test-governance-personal-project-${fixture.ns}`,
          apiKey: `test-key-governance-personal-${fixture.ns}`,
          teamId: personalTeam.id,
          language: "internal",
          framework: "governance",
          kind: "internal_governance",
          isPersonal: true,
          ownerUserId: fixture.member.id,
        },
      });

      const aggregate = await createAggregate({ kind: "all-personal" });

      const members = await liveMembersOf(aggregate.id);
      expect(members).toEqual(
        [fixture.personal.engineer.id, fixture.personal.seller.id].sort(),
      );
      expect(members).not.toContain(fixture.governance.id);
      expect(members).not.toContain(personalLookingGovernance.id);
    });
  });
});
