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

import { DepartmentService } from "@ee/governance/services/department/department.service";
import { AuthzCollectorService, AuthzService } from "@langwatch/authz-server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  OrganizationUserRole,
} from "~/generated/prisma/client";
import { NullLwqlKeyMapRepository } from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { AuthorizationService } from "~/server/app-layer/authz/authorization.service";
import {
  GrantsLedgerWriter,
  resetAuthzGrantsCommandsForTests,
} from "~/server/app-layer/authz/ledger";
import { GrantsAuthzReadRepository } from "~/server/app-layer/authz/repositories/authz-read.grants.repository";
import { SharedReadsGrantsRepository } from "~/server/app-layer/authz/repositories/shared-reads.grants.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { PrismaScheduledJobRepository } from "~/server/app-layer/scheduler/scheduled-job.repository";
import { prisma } from "~/server/db";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import {
  AGGREGATE_RULE_NO_LONGER_MATCHES,
  AggregateReconciler,
} from "../aggregate-reconciler.service";
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

// Invite acceptance asks the identity projection which addresses the user
// has verified; `null` is its answer for a user not yet on identifiers, which
// keeps the session-email comparison. The projection has its own suites.
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/app-layer/identity/runtime")
    >();
  return {
    ...original,
    identityEmail: () => ({
      resolveEmail: () => Promise.resolve(null),
      verifiedEmailsOf: () => Promise.resolve(null),
    }),
  };
});

const callerFor = (
  userId: string,
  user: { email?: string; name?: string } = {},
) =>
  appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: userId, ...user }, expires: "1" },
    }),
  );

const ruleRepository = new PrismaAggregateRuleRepository(prisma);
const rules = new AggregateRuleService(ruleRepository);
const reconciler = new AggregateReconciler({
  aggregates: ruleRepository,
  rules,
  ledger: () => new GrantsLedgerWriter(prisma),
  schedule: new PrismaScheduledJobRepository(prisma),
});

/** The door every trace read goes through: what the proof says is readable. */
const authorizationDoor = () => {
  const collector = new AuthzCollectorService(
    new GrantsAuthzReadRepository(prisma),
  );
  return new AuthorizationService({
    authz: new AuthzService(collector),
    collector,
    sharedReads: new SharedReadsGrantsRepository(prisma),
  });
};

describe("Feature: the reconciler keeps members current", () => {
  let fixture: AggregateFixture;

  /** The projects a trace read on the aggregate may reach through grants. */
  const sharedProjectsInProof = async (aggregateProjectId: string) => {
    const proof = await authorizationDoor().authorize({
      actor: { type: "user", id: fixture.admin.id },
      principal: { type: "user", id: fixture.admin.id },
      permission: "traces:view",
      scope: { projectId: aggregateProjectId },
      purpose: { kind: "route", route: "traces.list" },
    });
    return proof.grants
      .filter((grant) => grant.kind === "shared")
      .map((grant) => grant.projectId)
      .sort();
  };

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
      if (fixture) {
        await prisma.organizationInvite.deleteMany({
          where: { organizationId: fixture.organizationId },
        });
      }
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

  /** @scenario "A new personal project joins an all-personal aggregate on creation" */
  describe("given an aggregate project with the rule all personal projects", () => {
    describe("when a new member accepts an invite and their personal project is created", () => {
      it("makes the new personal project a member of the aggregate", async () => {
        const aggregate = await createAggregate({ kind: "all-personal" });
        const email = `newcomer-${fixture.ns}@example.com`;
        const newcomer = await prisma.user.create({
          data: { email, name: "Newcomer" },
        });
        const invite = await prisma.organizationInvite.create({
          data: {
            email,
            inviteCode: nanoid(),
            expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
            organizationId: fixture.organizationId,
            teamIds: fixture.team.id,
            role: OrganizationUserRole.MEMBER,
            status: "PENDING",
          },
        });

        await callerFor(newcomer.id, {
          email,
          name: "Newcomer",
        }).invite.acceptInvite({ inviteCode: invite.inviteCode });

        const personal = await prisma.project.findFirstOrThrow({
          where: {
            isPersonal: true,
            ownerUserId: newcomer.id,
            team: { organizationId: fixture.organizationId },
          },
        });
        expect(await liveMembersOf(aggregate.id)).toContain(personal.id);
      });
    });
  });

  /** @scenario "A department move updates a by-department aggregate" */
  describe("given an aggregate project with the rule personal projects in department Engineering", () => {
    describe("when a member in Engineering is moved to department Sales", () => {
      it("revokes their personal project's read, and a move back restores it", async () => {
        const departments = new DepartmentService(prisma);
        await departments.assignUser({
          organizationId: fixture.organizationId,
          userId: fixture.engineer.id,
          departmentId: fixture.departments.engineering.id,
        });
        const aggregate = await createAggregate({
          kind: "personal-by-department",
          departmentId: fixture.departments.engineering.id,
        });
        expect(await liveMembersOf(aggregate.id)).toEqual([
          fixture.personal.engineer.id,
        ]);

        try {
          await departments.assignUser({
            organizationId: fixture.organizationId,
            userId: fixture.engineer.id,
            departmentId: fixture.departments.sales.id,
          });

          expect(await liveMembersOf(aggregate.id)).toEqual([]);

          // And back: the pair revoked a moment ago reads again, on a new row.
          await departments.assignUser({
            organizationId: fixture.organizationId,
            userId: fixture.engineer.id,
            departmentId: fixture.departments.engineering.id,
          });
          expect(await liveMembersOf(aggregate.id)).toEqual([
            fixture.personal.engineer.id,
          ]);
        } finally {
          await departments.assignUser({
            organizationId: fixture.organizationId,
            userId: fixture.engineer.id,
            departmentId: fixture.departments.engineering.id,
          });
        }
      });
    });
  });

  /** @scenario "Removing a project from an explicit rule revokes its read" */
  describe("given an aggregate project with an explicit list of two projects", () => {
    describe("when ana edits the rule to drop one project", () => {
      it("drops that project from the proof and keeps its grant row, marked revoked", async () => {
        const kept = fixture.shared.id;
        const dropped = fixture.personal.seller.id;
        const aggregate = await createAggregate({
          kind: "explicit",
          projectIds: [kept, dropped],
        });
        expect(await sharedProjectsInProof(aggregate.id)).toEqual(
          [kept, dropped].sort(),
        );

        await callerFor(fixture.admin.id).project.updateAggregateRule({
          projectId: aggregate.id,
          aggregateRule: { kind: "explicit", projectIds: [kept] },
        });

        expect(await sharedProjectsInProof(aggregate.id)).toEqual([kept]);
        const droppedRows = (await sharedReadRowsOf(aggregate.id)).filter(
          (row) => row.scopeId === dropped,
        );
        expect(droppedRows).toHaveLength(1);
        expect(droppedRows[0]?.revokedAt).not.toBeNull();
        expect(droppedRows[0]?.revokedReason).toBe(
          AGGREGATE_RULE_NO_LONGER_MATCHES,
        );
        expect(
          (
            await prisma.project.findUniqueOrThrow({
              where: { id: aggregate.id },
            })
          ).aggregateRule,
        ).toEqual({ kind: "explicit", projectIds: [kept] });
      });
    });

    describe("when a member who is not an admin asks to edit the rule", () => {
      it("is refused and the rule and its reads stay as they were", async () => {
        const aggregate = await createAggregate({
          kind: "explicit",
          projectIds: [fixture.shared.id, fixture.personal.seller.id],
        });

        await expect(
          callerFor(fixture.member.id).project.updateAggregateRule({
            projectId: aggregate.id,
            aggregateRule: {
              kind: "explicit",
              projectIds: [fixture.shared.id],
            },
          }),
        ).rejects.toThrow();

        expect(await liveMembersOf(aggregate.id)).toEqual(
          [fixture.shared.id, fixture.personal.seller.id].sort(),
        );
      });
    });
  });

  /** @scenario "Reconciling twice changes nothing" */
  describe("given an aggregate project whose members are current", () => {
    describe("when the reconciler runs again", () => {
      it("leaves the same grant rows with the same ids and no duplicate", async () => {
        const aggregate = await createAggregate({ kind: "all-personal" });
        const before = await sharedReadRowsOf(aggregate.id);
        expect(before.length).toBeGreaterThan(0);

        const again = await reconciler.reconcile({
          aggregateProjectId: aggregate.id,
        });

        expect(again.attached).toEqual([]);
        expect(again.revoked).toEqual([]);
        const after = await sharedReadRowsOf(aggregate.id);
        expect(after).toEqual(before);
        const live = after.filter((row) => row.revokedAt === null);
        expect(new Set(live.map((row) => row.scopeId)).size).toBe(live.length);
      });
    });
  });
});
