/**
 * @vitest-environment node
 *
 * The leak gate: the org's hidden governance project is STORED like a project
 * and listed like nothing.
 *
 * ADR-128 gives every pulled provider cost row an explicit home — the hidden
 * `kind="internal_governance"` project — so nothing arrives homeless. That
 * only works if the home is invisible: a member who can see it sees an
 * internal artifact in their project picker, their retention scope chips,
 * their API-key scope list and their cost breakdown.
 *
 * Table-driven over every listing surface class, against real Postgres. Each
 * surface is driven for real — its own repository method, read snapshot or
 * tRPC procedure — and asked for the project ids it would show a member.
 *
 * Guard that cannot fail: every surface asserts the seeded APPLICATION
 * project IS returned before asserting the governance one is not. A filter
 * that returned nothing at all would otherwise read as a passing leak gate,
 * and so would a seeding bug. The `unfiltered population` case pins the other
 * end: the same org, read without the safeguard, does contain the home.
 *
 * Spec: specs/governance/pulled-rows-home-and-leak-gate.feature
 *       specs/ai-gateway/governance/ui-contract.feature
 * Decision: ADR-128.
 */

import { DepartmentService } from "@ee/governance/services/department/department.service";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CostReferenceType,
  CostType,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { ApiKeyRepository } from "~/server/api-key/api-key.repository";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { getDataPrivacySnapshot } from "~/server/data-privacy/dataPrivacyPolicy.read";
import { getRetentionPolicySnapshot } from "~/server/data-retention/policy/dataRetentionPolicy.read";
import { prisma } from "~/server/db";
import { getDefaultModelsSnapshot } from "~/server/modelProviders/modelDefaults.read";
import { resolveCallerProjectScope } from "~/server/organizations/resolveCallerProjectScope";
import { TeamService } from "~/server/teams/team.service";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

wireDefaultTestApp();

const ns = `gov-leak-${nanoid(8)}`;

let organizationId: string;
let teamId: string;
let applicationProjectId: string;
let governanceProjectId: string;
let userId: string;
let caller: ReturnType<typeof appRouter.createCaller>;

/** The `ReadCtx` the three settings snapshots take, as their router builds it. */
function readCtx() {
  return {
    prisma,
    session: {
      user: { id: userId, email: `${ns}@example.com`, name: "Leak Gate" },
      expires: "2099-01-01T00:00:00.000Z",
    },
  } as Parameters<typeof getDefaultModelsSnapshot>[0];
}

/**
 * One member-facing listing: the project ids a member would see there.
 *
 * `name` is the words the failure message uses, so a leak names the screen a
 * customer would have seen it on rather than a method the reader has to go
 * look up.
 */
interface ListingSurface {
  name: string;
  ids: () => Promise<string[]>;
}

const surfaces: ListingSurface[] = [
  {
    name: "the projects REST list",
    ids: async () => {
      const page = await new PrismaProjectRepository(
        prisma,
      ).findAllByOrganization({ organizationId, page: 1, limit: 100 });
      return page.data.map((p) => p.id);
    },
  },
  {
    name: "the organization project tree behind the project selector",
    ids: async () => {
      const orgs = await new PrismaOrganizationRepository(prisma).getAllForUser(
        {
          userId,
          isDemo: false,
          demoProjectUserId: "",
          demoProjectId: "",
        },
      );
      const org = orgs.find((o) => o.id === organizationId);
      return (org?.teams ?? []).flatMap((t) => t.projects.map((p) => p.id));
    },
  },
  {
    name: "team and RBAC settings",
    ids: async () => {
      const teams = await new TeamService({ prisma }).getTeamsWithRoleBindings({
        organizationId,
      });
      return teams.flatMap((t) => t.projects.map((p) => p.id));
    },
  },
  {
    name: "the API-key scope picker",
    ids: async () => {
      const projects = await ApiKeyRepository.create(prisma).findProjectsInOrg({
        organizationId,
      });
      return projects.map((p) => p.id);
    },
  },
  {
    name: "the plan-limit alert's per-project lines",
    ids: async () => {
      const projects = await new PrismaOrganizationRepository(
        prisma,
      ).findProjectsWithName(organizationId);
      return projects.map((p) => p.id);
    },
  },
  {
    name: "the data-privacy scope picker",
    ids: async () => {
      const snapshot = await getDataPrivacySnapshot(readCtx(), {
        projectId: applicationProjectId,
      });
      return snapshot.available.projects.map((p) => p.id);
    },
  },
  {
    name: "the data-retention scope picker",
    ids: async () => {
      const snapshot = await getRetentionPolicySnapshot(readCtx(), {
        projectId: applicationProjectId,
      });
      return snapshot.available.projects.map((p) => p.id);
    },
  },
  {
    name: "the model-defaults scope picker",
    ids: async () => {
      const snapshot = await getDefaultModelsSnapshot(readCtx(), {
        projectId: applicationProjectId,
      });
      return snapshot.available.projects.map((p) => p.id);
    },
  },
  {
    name: "department assignment",
    ids: async () => {
      const assignments = await DepartmentService.create(prisma).getAssignments(
        { organizationId },
      );
      return assignments.projects.map((p) => p.id);
    },
  },
  {
    name: "the caller project scope map",
    ids: async () => {
      const scope = await resolveCallerProjectScope({
        userId,
        organizationId,
        prisma,
      });
      return scope.permittedProjectIds;
    },
  },
  {
    name: "cost by project",
    ids: async () => {
      const rows = await caller.costs.getAggregatedCostsForOrganization({
        organizationId,
        startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
        endDate: Date.now(),
      });
      return rows.map((r) => r.project.id);
    },
  },
];

/**
 * One surface, by the name it declares rather than its position.
 *
 * The scenario-bound cases below each speak about specific surfaces. Reaching
 * them by index means inserting a surface silently re-points every case after
 * it at a different one — and nothing fails, because every case asserts the
 * same two facts about whichever surface it was handed. The scenario would
 * then claim coverage of a surface no test had looked at.
 */
function surfaceNamed({ name }: { name: string }): ListingSurface {
  const surface = surfaces.find((candidate) => candidate.name === name);
  if (!surface) {
    throw new Error(`No listing surface named "${name}" — was it renamed?`);
  }
  return surface;
}

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Leak Gate ${ns}`, slug: `--test-org-${ns}` },
  });
  organizationId = organization.id;

  const team = await prisma.team.create({
    data: {
      name: `Leak Gate ${ns}`,
      slug: `--test-team-${ns}`,
      organizationId,
    },
  });
  teamId = team.id;

  const mkProject = ({ slug, kind }: { slug: string; kind: string }) =>
    prisma.project.create({
      data: {
        name: `Project ${slug} ${ns}`,
        slug: `--proj-${slug}-${ns}`,
        apiKey: `test-key-${slug}-${ns}`,
        teamId,
        language: "typescript",
        framework: "other",
        kind,
      },
    });
  applicationProjectId = (await mkProject({ slug: "app", kind: "application" }))
    .id;
  governanceProjectId = (
    await mkProject({ slug: "gov", kind: "internal_governance" })
  ).id;

  const user = await prisma.user.create({
    data: { name: "Leak Gate", email: `${ns}@example.com` },
  });
  userId = user.id;

  // ADMIN at every level the surfaces read: `OrganizationUser.role` is what
  // the cost view's own query checks, the ORGANIZATION-scope binding is what
  // the RBAC-filtered snapshots resolve, and the TeamUser row keeps the cost
  // view's first branch true as well. Anything less and a surface could
  // return an empty list for a permission reason, which would read as a
  // passing leak gate.
  await prisma.organizationUser.create({
    data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId,
      userId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
  });
  await prisma.teamUser.create({
    data: { userId, teamId, role: TeamUserRole.ADMIN },
  });

  // The cost view drops a project with no spend in the window, so both
  // projects need a row or its exclusion would prove nothing.
  await prisma.cost.createMany({
    data: [applicationProjectId, governanceProjectId].map((projectId) => ({
      projectId,
      costType: CostType.TRACE_CHECK,
      referenceType: CostReferenceType.CHECK,
      referenceId: `check-${projectId}`,
      costName: "leak gate",
      amount: 1.5,
      currency: "USD",
    })),
  });

  caller = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" },
    }),
  );
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    [
      "cost",
      { projectId: { in: [applicationProjectId, governanceProjectId] } },
    ],
    ["roleBinding", { organizationId }],
    ["teamUser", { teamId }],
    ["organizationUser", { organizationId }],
    ["project", { id: { in: [applicationProjectId, governanceProjectId] } }],
    ["team", { id: teamId }],
    ["organization", { id: organizationId }],
    ["user", { id: userId }],
  ]);
});

describe("the hidden governance project as a member sees it", () => {
  describe("given an organization holding both a real project and its governance home", () => {
    describe("when every listing surface is swept at once", () => {
      /** @scenario "The governance home never appears anywhere members list projects" */
      it("keeps the home out of every member-facing listing surface", async () => {
        // The other end of the guard first: without the safeguard the home IS
        // in this org's project population, so a surface that omits it below is
        // filtering rather than looking at an empty org.
        const unfiltered = await prisma.project.findMany({
          where: { team: { organizationId } },
          select: { id: true },
        });
        expect(unfiltered.map((p) => p.id)).toContain(governanceProjectId);
        expect(unfiltered.map((p) => p.id)).toContain(applicationProjectId);

        const leaked: string[] = [];
        const blind: string[] = [];
        for (const surface of surfaces) {
          const ids = await surface.ids();
          if (!ids.includes(applicationProjectId)) blind.push(surface.name);
          if (ids.includes(governanceProjectId)) leaked.push(surface.name);
        }

        // Reported before the leak list: a surface that showed the member
        // nothing would have "excluded" the home for the wrong reason.
        expect(blind).toEqual([]);
        expect(leaked).toEqual([]);
      });
    });

    describe("when the project selector loads its tree", () => {
      /** @scenario "The hidden Governance Project never appears in the ProjectSelector dropdown" */
      it("keeps it out of the project selector's own tree", async () => {
        const ids = await surfaceNamed({
          name: "the organization project tree behind the project selector",
        }).ids();

        expect(ids).toContain(applicationProjectId);
        expect(ids).not.toContain(governanceProjectId);
      });
    });

    describe("when the projects REST list is paged", () => {
      /** @scenario "The hidden Governance Project never appears in /api/v1/projects responses" */
      it("keeps it out of the projects REST list, count included", async () => {
        const page = await new PrismaProjectRepository(
          prisma,
        ).findAllByOrganization({ organizationId, page: 1, limit: 100 });

        expect(page.data.map((p) => p.id)).toContain(applicationProjectId);
        expect(page.data.map((p) => p.id)).not.toContain(governanceProjectId);
        // The count is filtered by the same `where`, so the total cannot
        // betray a row the page does not list.
        expect(page.pagination.total).toBe(page.data.length);
      });
    });

    describe("when the billing surfaces are built", () => {
      /** @scenario "The hidden Governance Project never appears in billing exports or invoice line-items" */
      it("keeps it out of per-project cost and plan-limit lines", async () => {
        const costIds = await surfaceNamed({ name: "cost by project" }).ids();
        const alertIds = await surfaceNamed({
          name: "the plan-limit alert's per-project lines",
        }).ids();

        expect(costIds).toContain(applicationProjectId);
        expect(costIds).not.toContain(governanceProjectId);
        expect(alertIds).toContain(applicationProjectId);
        expect(alertIds).not.toContain(governanceProjectId);
      });
    });

    describe("when an RBAC picker is opened", () => {
      /** @scenario "The hidden Governance Project never appears in RBAC role binding pickers" */
      it("keeps it out of team settings and the API-key scope picker", async () => {
        const teamIds = await surfaceNamed({
          name: "team and RBAC settings",
        }).ids();
        const apiKeyIds = await surfaceNamed({
          name: "the API-key scope picker",
        }).ids();

        expect(teamIds).toContain(applicationProjectId);
        expect(teamIds).not.toContain(governanceProjectId);
        expect(apiKeyIds).toContain(applicationProjectId);
        expect(apiKeyIds).not.toContain(governanceProjectId);
      });
    });

    describe("when the remaining settings pickers are opened", () => {
      /** @scenario "The hidden Governance Project never appears in any other user-visible Project surface" */
      it("keeps it out of the settings scope pickers and the caller scope map", async () => {
        const names = [
          "the data-privacy scope picker",
          "the data-retention scope picker",
          "the model-defaults scope picker",
          "department assignment",
          "the caller project scope map",
        ];
        for (const name of names) {
          const ids = await surfaceNamed({ name }).ids();

          expect(ids, `${name} shows the member nothing`).toContain(
            applicationProjectId,
          );
          expect(ids, `${name} leaks the home`).not.toContain(
            governanceProjectId,
          );
        }
      });
    });
  });
});
