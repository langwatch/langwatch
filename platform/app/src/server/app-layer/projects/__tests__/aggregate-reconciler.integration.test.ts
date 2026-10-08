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
import {
  AuthzCollectorService,
  AuthzService,
  roleFactToRow,
} from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { NullLwqlKeyMapRepository } from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { getApp, globalForApp, resetApp } from "~/server/app-layer/app";
import { AuthorizationService } from "~/server/app-layer/authz/authorization.service";
import {
  GrantsLedgerWriter,
  resetAuthzGrantsCommandsForTests,
} from "~/server/app-layer/authz/ledger";
import { GrantsAuthzReadRepository } from "~/server/app-layer/authz/repositories/authz-read.grants.repository";
import { SharedReadsGrantsRepository } from "~/server/app-layer/authz/repositories/shared-reads.grants.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { PrismaScheduledJobRepository } from "~/server/app-layer/scheduler/scheduled-job.repository";
import { SchedulerRegistry } from "~/server/app-layer/scheduler/scheduler.registry";
import { prisma } from "~/server/db";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  AGGREGATE_ARCHIVED,
  AGGREGATE_RECONCILE_SWEEP,
  AGGREGATE_RULE_NO_LONGER_MATCHES,
  AggregateReconciler,
  aggregateReconcileSweepHandler,
} from "../aggregate-reconciler.service";
import type { AggregateRule } from "../aggregate-rule";
import { AggregateRuleService } from "../aggregate-rule.service";
import { ProjectService } from "../project.service";
import { AGGREGATE_PROJECT_KIND } from "../project-kinds";
import { PrismaAggregateReconcileLock } from "../repositories/aggregate-reconcile-lock.prisma.repository";
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
  lock: new PrismaAggregateReconcileLock(prisma),
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
        { rules, reconciler },
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

  describe("when ana creates an aggregate project with the rule all personal projects", () => {
    /** @scenario "The hidden governance project is never a member" */
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

  describe("given an aggregate project with the rule all personal projects", () => {
    describe("when a new member accepts an invite and their personal project is created", () => {
      /** @scenario "A new personal project joins an all-personal aggregate on creation" */
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

  describe("when ana creates an aggregate project with the rule all personal projects plus one LLMOps project", () => {
    /** @scenario "The rule may read every personal workspace plus named projects" */
    it("attaches every personal project and the named LLMOps project", async () => {
      const aggregate = await createAggregate({
        kind: "all-personal",
        projectIds: [fixture.shared.id],
      });

      // Earlier scenarios add personal workspaces of their own, so this
      // names the ones the fixture seeds rather than the whole list.
      const members = await liveMembersOf(aggregate.id);
      expect(members).toEqual(
        expect.arrayContaining([
          fixture.personal.engineer.id,
          fixture.personal.seller.id,
          fixture.shared.id,
        ]),
      );
      expect(members).not.toContain(fixture.governance.id);
      expect(
        (
          await prisma.project.findUniqueOrThrow({
            where: { id: aggregate.id },
          })
        ).aggregateRule,
      ).toEqual({ kind: "all-personal", projectIds: [fixture.shared.id] });
    });
  });

  describe("given an aggregate project with the rule all personal projects plus one LLMOps project", () => {
    describe("when a new member accepts an invite and their personal project is created", () => {
      /** @scenario "A new member joins an aggregate that reads every personal workspace plus named projects" */
      it("adds the new personal project and keeps the named LLMOps project", async () => {
        const aggregate = await createAggregate({
          kind: "all-personal",
          projectIds: [fixture.shared.id],
        });
        const email = `combined-newcomer-${fixture.ns}@example.com`;
        const newcomer = await prisma.user.create({
          data: { email, name: "Combined newcomer" },
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
          name: "Combined newcomer",
        }).invite.acceptInvite({ inviteCode: invite.inviteCode });

        const personal = await prisma.project.findFirstOrThrow({
          where: {
            isPersonal: true,
            ownerUserId: newcomer.id,
            team: { organizationId: fixture.organizationId },
          },
        });
        const members = await liveMembersOf(aggregate.id);
        expect(members).toContain(personal.id);
        expect(members).toContain(fixture.shared.id);
      });
    });
  });

  describe("given an aggregate project with the rule personal projects in department Engineering", () => {
    describe("when a member in Engineering is moved to department Sales", () => {
      /** @scenario "A department move updates a by-department aggregate" */
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

  describe("given an aggregate project with an explicit list of two projects", () => {
    describe("when ana edits the rule to drop one project", () => {
      /** @scenario "Removing a project from an explicit rule revokes its read" */
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
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          cause: { code: "permission_denied" },
        });

        expect(await liveMembersOf(aggregate.id)).toEqual(
          [fixture.shared.id, fixture.personal.seller.id].sort(),
        );
      });
    });

    describe("when a member whose custom role grants organization:manage, but who is not an admin, asks to edit the rule", () => {
      it("is refused because only an organisation admin opens an aggregate", async () => {
        const aggregate = await createAggregate({
          kind: "explicit",
          projectIds: [fixture.shared.id, fixture.personal.seller.id],
        });
        const manager = await fixture.makeUser({
          handle: `manager-${nanoid(6)}`,
          organizationRole: OrganizationUserRole.MEMBER,
        });
        const permissions = ["organization:manage"];
        const customRole = await prisma.customRole.create({
          data: {
            organizationId: fixture.organizationId,
            name: `Organisation manager ${fixture.ns}-${nanoid(4)}`,
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

        // The role does grant organization:manage: on an ordinary project the
        // permission check lets the manager through to the kind check.
        await expect(
          callerFor(manager.id).project.updateAggregateRule({
            projectId: fixture.shared.id,
            aggregateRule: { kind: "all-personal" },
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });

        // On the aggregate the permission check itself refuses: a project
        // permission on an aggregate is gated on the organisation admin role
        // (ADR-144 decision 5), ahead of the mutation's own admin check.
        await expect(
          callerFor(manager.id).project.updateAggregateRule({
            projectId: aggregate.id,
            aggregateRule: {
              kind: "explicit",
              projectIds: [fixture.shared.id],
            },
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          cause: { code: "permission_denied" },
        });

        expect(await liveMembersOf(aggregate.id)).toEqual(
          [fixture.shared.id, fixture.personal.seller.id].sort(),
        );
      });
    });

    describe("when ana asks to edit the rule of a project that is not an aggregate", () => {
      it("is refused as not found and the project keeps no rule", async () => {
        await expect(
          callerFor(fixture.admin.id).project.updateAggregateRule({
            projectId: fixture.shared.id,
            aggregateRule: { kind: "all-personal" },
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });

        expect(
          (
            await prisma.project.findUniqueOrThrow({
              where: { id: fixture.shared.id },
            })
          ).aggregateRule,
        ).toBeNull();
      });
    });

    describe("when ana asks to edit the rule of an archived aggregate", () => {
      it("is refused and attaches nothing", async () => {
        const aggregate = await createAggregate({
          kind: "explicit",
          projectIds: [fixture.shared.id],
        });
        await getApp().projects.archive({
          id: aggregate.id,
          organizationId: fixture.organizationId,
        });

        await expect(
          callerFor(fixture.admin.id).project.updateAggregateRule({
            projectId: aggregate.id,
            aggregateRule: { kind: "all-personal" },
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });

        expect(await liveMembersOf(aggregate.id)).toEqual([]);
        expect(
          (
            await prisma.project.findUniqueOrThrow({
              where: { id: aggregate.id },
            })
          ).aggregateRule,
        ).toEqual({ kind: "explicit", projectIds: [fixture.shared.id] });
      });
    });

    describe("when ana asks to edit the rule of an aggregate in another organisation", () => {
      it("is refused and the other organisation's rule and reads stay as they were", async () => {
        const foreign = await seedAggregateOrganization(prisma, {
          label: "agg-reconcile-foreign",
        });
        try {
          const foreignAggregate = await foreign.makeAggregate("foreign-view");

          await expect(
            callerFor(fixture.admin.id).project.updateAggregateRule({
              projectId: foreignAggregate.id,
              aggregateRule: {
                kind: "explicit",
                projectIds: [foreign.shared.id],
              },
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            cause: { code: "permission_denied" },
          });

          expect(
            (
              await prisma.project.findUniqueOrThrow({
                where: { id: foreignAggregate.id },
              })
            ).aggregateRule,
          ).toEqual({ kind: "all-personal" });
          expect(
            await prisma.grant.count({
              where: {
                organizationId: foreign.organizationId,
                principalId: foreignAggregate.id,
              },
            }),
          ).toBe(0);
        } finally {
          await foreign.cleanup();
        }
      });
    });
  });

  describe("given an aggregate project whose members are current", () => {
    describe("when the reconciler runs again", () => {
      /** @scenario "Reconciling twice changes nothing" */
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

  describe("given aggregate projects that read a member's personal project", () => {
    /** A member with a personal workspace of their own, as sign-up leaves one. */
    const memberWithWorkspace = async (handle: string) => {
      const user = await fixture.makeUser({
        handle,
        organizationRole: OrganizationUserRole.MEMBER,
      });
      const team = await prisma.team.create({
        data: {
          name: `${handle} workspace ${fixture.ns}`,
          slug: `--test-personal-${handle}-${fixture.ns}`,
          organizationId: fixture.organizationId,
          isPersonal: true,
          ownerUserId: user.id,
        },
      });
      const project = await prisma.project.create({
        data: {
          name: `${handle} personal ${fixture.ns}`,
          slug: `--test-personal-project-${handle}-${fixture.ns}`,
          apiKey: `test-key-${handle}-${fixture.ns}`,
          teamId: team.id,
          language: "python",
          framework: "openai",
          isPersonal: true,
          ownerUserId: user.id,
        },
      });
      return { user, project };
    };

    describe("when an admin removes that member from the organisation", () => {
      it("revokes their personal project's read from every aggregate", async () => {
        const leaver = await memberWithWorkspace("leaver");
        const everyone = await createAggregate({ kind: "all-personal" });
        const named = await createAggregate({
          kind: "explicit",
          projectIds: [leaver.project.id, fixture.shared.id],
        });
        expect(await liveMembersOf(everyone.id)).toContain(leaver.project.id);
        expect(await liveMembersOf(named.id)).toContain(leaver.project.id);

        await callerFor(fixture.admin.id).organization.deleteMember({
          organizationId: fixture.organizationId,
          userId: leaver.user.id,
        });

        expect(await liveMembersOf(everyone.id)).not.toContain(
          leaver.project.id,
        );
        expect(await liveMembersOf(named.id)).toEqual([fixture.shared.id]);
      });
    });
  });

  describe("given an aggregate project with an explicit list of team projects", () => {
    describe("when one of those projects is archived from the projects page", () => {
      it("revokes the archived project's read", async () => {
        const archived = await fixture.makeTeamProject(
          `archived-from-page-${nanoid(6)}`,
        );
        const aggregate = await createAggregate({
          kind: "explicit",
          projectIds: [archived.id, fixture.shared.id],
        });
        expect(await liveMembersOf(aggregate.id)).toContain(archived.id);

        await callerFor(fixture.admin.id).project.archiveById({
          projectId: fixture.shared.id,
          projectToArchiveId: archived.id,
        });

        expect(await liveMembersOf(aggregate.id)).toEqual([fixture.shared.id]);
      });
    });

    describe("when one of those projects is archived through the project service", () => {
      it("revokes the archived project's read", async () => {
        const archived = await fixture.makeTeamProject(
          `archived-by-service-${nanoid(6)}`,
        );
        const aggregate = await createAggregate({
          kind: "explicit",
          projectIds: [archived.id, fixture.shared.id],
        });
        expect(await liveMembersOf(aggregate.id)).toContain(archived.id);

        await getApp().projects.archive({
          id: archived.id,
          organizationId: fixture.organizationId,
        });

        expect(await liveMembersOf(aggregate.id)).toEqual([fixture.shared.id]);
      });
    });
  });

  describe("given an aggregate on a team of its own reading a project on another team", () => {
    /** A non-personal team of the organisation, which an admin may archive. */
    const makeTeam = (handle: string) =>
      prisma.team.create({
        data: {
          name: `${handle} ${nanoid(6)}`,
          slug: `--test-team-${handle}-${nanoid(8)}`,
          organizationId: fixture.organizationId,
        },
      });

    const aggregateOnTeam = async ({
      teamId,
      projectIds,
    }: {
      teamId: string;
      projectIds: string[];
    }) => {
      const { projectSlug } = await callerFor(fixture.admin.id).project.create({
        organizationId: fixture.organizationId,
        teamId,
        name: `Team view ${nanoid(6)}`,
        language: "other",
        framework: "other",
        kind: AGGREGATE_PROJECT_KIND,
        aggregateRule: { kind: "explicit", projectIds },
      });
      return prisma.project.findFirstOrThrow({
        where: { slug: projectSlug, teamId },
      });
    };

    const memberOnTeam = (teamId: string) =>
      prisma.project.create({
        data: {
          name: `Member ${nanoid(6)}`,
          slug: `--test-project-member-${nanoid(8)}`,
          apiKey: `test-key-member-${nanoid(8)}`,
          teamId,
          language: "python",
          framework: "openai",
        },
      });

    describe("when ana archives the aggregate's team", () => {
      it("stops the aggregate: no live shared read and no nightly sweep", async () => {
        const viewTeam = await makeTeam("view");
        const aggregate = await aggregateOnTeam({
          teamId: viewTeam.id,
          projectIds: [fixture.shared.id],
        });
        expect(await liveMembersOf(aggregate.id)).toEqual([fixture.shared.id]);

        await callerFor(fixture.admin.id).team.archiveById({
          teamId: viewTeam.id,
        });

        expect(await liveMembersOf(aggregate.id)).toEqual([]);
        expect(
          (await sharedReadRowsOf(aggregate.id)).map(
            (row) => row.revokedReason,
          ),
        ).toEqual([AGGREGATE_ARCHIVED]);
        const sweep = await prisma.scheduledJob.findFirstOrThrow({
          where: {
            projectId: aggregate.id,
            targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
          },
        });
        expect(sweep.active).toBe(false);
      });
    });

    describe("when ana archives the member project's team", () => {
      it("revokes that project's read and keeps the others", async () => {
        const memberTeam = await makeTeam("member");
        const member = await memberOnTeam(memberTeam.id);
        const aggregate = await aggregateOnTeam({
          teamId: fixture.team.id,
          projectIds: [member.id, fixture.shared.id],
        });
        expect(await liveMembersOf(aggregate.id)).toEqual(
          [member.id, fixture.shared.id].sort(),
        );

        await callerFor(fixture.admin.id).team.archiveById({
          teamId: memberTeam.id,
        });

        expect(await liveMembersOf(aggregate.id)).toEqual([fixture.shared.id]);
      });
    });
  });

  describe("given aggregate projects whose members no reconcile has attached yet", () => {
    describe("when one reconcile attaches several members", () => {
      it("waits for the projection once and lands every member", async () => {
        const aggregate = await prisma.project.create({
          data: {
            name: `Batched view ${fixture.ns}`,
            slug: `--test-batched-aggregate-${fixture.ns}`,
            apiKey: `test-key-batched-aggregate-${fixture.ns}`,
            teamId: fixture.team.id,
            language: "other",
            framework: "other",
            kind: AGGREGATE_PROJECT_KIND,
            aggregateRule: {
              kind: "explicit",
              projectIds: [
                fixture.shared.id,
                fixture.personal.engineer.id,
                fixture.personal.seller.id,
              ],
            },
          },
        });
        const waits = vi.spyOn(
          GrantsLedgerWriter.prototype,
          "awaitSharedProjectGrants",
        );

        try {
          const result = await reconciler.reconcile({
            aggregateProjectId: aggregate.id,
          });

          expect(result.attached).toHaveLength(3);
          expect(result.failed).toEqual([]);
          expect(waits).toHaveBeenCalledTimes(1);
          expect(waits.mock.calls[0]?.[0].grantIds).toHaveLength(3);
          expect(await liveMembersOf(aggregate.id)).toEqual(
            [
              fixture.shared.id,
              fixture.personal.engineer.id,
              fixture.personal.seller.id,
            ].sort(),
          );
        } finally {
          waits.mockRestore();
        }
      });
    });

    describe("when two reconciles of the same aggregate run at once", () => {
      it("Two reconciles at once leave one live row per pair", async () => {
        // Three races in a row: one can be won cleanly by luck, three rarely
        // are. One aggregate at a time, so each race is only the two runs.
        for (const index of [0, 1, 2]) {
          const aggregate = await prisma.project.create({
            data: {
              name: `Raced view ${index} ${fixture.ns}`,
              slug: `--test-raced-aggregate-${index}-${fixture.ns}`,
              apiKey: `test-key-raced-aggregate-${index}-${fixture.ns}`,
              teamId: fixture.team.id,
              language: "other",
              framework: "other",
              kind: AGGREGATE_PROJECT_KIND,
              aggregateRule: { kind: "all-personal" },
            },
          });

          await Promise.all([
            reconciler.reconcile({ aggregateProjectId: aggregate.id }),
            reconciler.reconcile({ aggregateProjectId: aggregate.id }),
          ]);

          const live = await liveMembersOf(aggregate.id);
          expect(live.length).toBeGreaterThanOrEqual(2);
          expect(new Set(live).size).toBe(live.length);
          expect(await sharedProjectsInProof(aggregate.id)).toEqual(live);
        }
      });
    });

    describe("when more reconciles run at once than the connection pool holds", () => {
      it("finishes every one, each aggregate with one live row per pair", async () => {
        // Twelve at once against the adapter's ten pooled connections: if each
        // lock pinned a connection, the bodies would wait on the pool forever.
        const aggregates = await Promise.all(
          [0, 1, 2, 3, 4, 5].map((index) =>
            prisma.project.create({
              data: {
                name: `Crowded view ${index} ${fixture.ns}`,
                slug: `--test-crowded-aggregate-${index}-${fixture.ns}`,
                apiKey: `test-key-crowded-aggregate-${index}-${fixture.ns}`,
                teamId: fixture.team.id,
                language: "other",
                framework: "other",
                kind: AGGREGATE_PROJECT_KIND,
                aggregateRule: { kind: "all-personal" },
              },
            }),
          ),
        );

        await Promise.all(
          aggregates.flatMap((aggregate) => [
            reconciler.reconcile({ aggregateProjectId: aggregate.id }),
            reconciler.reconcile({ aggregateProjectId: aggregate.id }),
          ]),
        );

        for (const aggregate of aggregates) {
          const live = await liveMembersOf(aggregate.id);
          expect(live.length).toBeGreaterThanOrEqual(2);
          expect(new Set(live).size).toBe(live.length);
        }
      });
    });
  });

  describe("given an aggregate project with the rule all personal projects", () => {
    describe("and a personal project created while the reconciler was unavailable", () => {
      describe("when the nightly sweep runs for the organisation", () => {
        /** @scenario "A nightly sweep catches a missed trigger" */
        it("makes that personal project a member", async () => {
          const aggregate = await createAggregate({ kind: "all-personal" });
          const job = await prisma.scheduledJob.findFirstOrThrow({
            where: {
              projectId: aggregate.id,
              targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
            },
          });
          expect(job).toMatchObject({
            targetId: aggregate.id,
            cron: AGGREGATE_RECONCILE_SWEEP.cron,
            timezone: AGGREGATE_RECONCILE_SWEEP.timezone,
            active: true,
          });

          // Written past every trigger, the way an outage would leave it.
          const latecomer = await fixture.makeUser({
            handle: "latecomer",
            organizationRole: OrganizationUserRole.MEMBER,
          });
          const latecomerTeam = await prisma.team.create({
            data: {
              name: `latecomer workspace ${fixture.ns}`,
              slug: `--test-personal-latecomer-${fixture.ns}`,
              organizationId: fixture.organizationId,
              isPersonal: true,
              ownerUserId: latecomer.id,
            },
          });
          const missed = await prisma.project.create({
            data: {
              name: `latecomer personal ${fixture.ns}`,
              slug: `--test-personal-project-latecomer-${fixture.ns}`,
              apiKey: `test-key-latecomer-${fixture.ns}`,
              teamId: latecomerTeam.id,
              language: "python",
              framework: "openai",
              isPersonal: true,
              ownerUserId: latecomer.id,
            },
          });
          expect(await liveMembersOf(aggregate.id)).not.toContain(missed.id);

          // The job as the scheduler fires it: the registered handler, handed
          // the row's own identity.
          const registry = new SchedulerRegistry();
          registry.register({
            targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
            handler: aggregateReconcileSweepHandler(reconciler),
          });
          await registry.get(job.targetType)?.({
            projectId: job.projectId,
            targetType: job.targetType,
            targetId: job.targetId,
            slot: job.nextRunAt,
          });

          expect(await liveMembersOf(aggregate.id)).toContain(missed.id);
        });
      });
    });

    describe("and its nightly sweep row is gone", () => {
      const sweepRowsOf = (aggregateProjectId: string) =>
        prisma.scheduledJob.findMany({
          where: {
            projectId: aggregateProjectId,
            targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
          },
        });

      describe("when the aggregate is next reconciled", () => {
        it("puts the sweep row back", async () => {
          const aggregate = await createAggregate({ kind: "all-personal" });
          await prisma.scheduledJob.deleteMany({
            where: {
              projectId: aggregate.id,
              targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
            },
          });

          await reconciler.reconcile({ aggregateProjectId: aggregate.id });

          const rows = await sweepRowsOf(aggregate.id);
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            targetId: aggregate.id,
            cron: AGGREGATE_RECONCILE_SWEEP.cron,
            active: true,
          });
        });
      });

      describe("when a worker boots", () => {
        it("schedules a sweep for the aggregate missing one", async () => {
          const aggregate = await createAggregate({ kind: "all-personal" });
          await prisma.scheduledJob.deleteMany({
            where: {
              projectId: aggregate.id,
              targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
            },
          });

          const { repaired } = await reconciler.scheduleMissingSweeps();

          expect(repaired).toBeGreaterThanOrEqual(1);
          expect(await sweepRowsOf(aggregate.id)).toHaveLength(1);
          // A second boot finds nothing left to repair for it.
          await reconciler.scheduleMissingSweeps();
          expect(await sweepRowsOf(aggregate.id)).toHaveLength(1);
        });
      });
    });

    describe("when the aggregate is archived", () => {
      it("switches its nightly sweep off", async () => {
        const aggregate = await createAggregate({ kind: "all-personal" });

        await callerFor(fixture.admin.id).project.archiveById({
          projectId: fixture.shared.id,
          projectToArchiveId: aggregate.id,
        });

        const job = await prisma.scheduledJob.findFirstOrThrow({
          where: {
            projectId: aggregate.id,
            targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
          },
        });
        expect(job.active).toBe(false);
      });

      it("leaves it no live shared read, each row marked archived rather than deleted", async () => {
        const aggregate = await createAggregate({ kind: "all-personal" });
        const before = await sharedReadRowsOf(aggregate.id);
        expect(before.length).toBeGreaterThanOrEqual(2);

        await getApp().projects.archive({
          id: aggregate.id,
          organizationId: fixture.organizationId,
        });

        expect(await liveMembersOf(aggregate.id)).toEqual([]);
        const after = await sharedReadRowsOf(aggregate.id);
        expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
        expect(after.map((row) => row.revokedReason)).toEqual(
          before.map(() => AGGREGATE_ARCHIVED),
        );
      });
    });
  });
});
