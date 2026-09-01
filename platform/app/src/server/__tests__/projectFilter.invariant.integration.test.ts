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

import fs from "node:fs";
import path from "node:path";
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
import { PrismaTeamRepository } from "~/server/app-layer/teams/repositories/team.prisma.repository";
import { TeamRestService } from "~/server/app-layer/teams/team.service";
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
 *
 * `module` is the source file whose project listing this surface drives,
 * relative to `platform/app`. It is what the registration sweep at the bottom
 * of this file matches against: a listing that filters the governance home
 * but names no surface here is a screen nobody proved is filtered.
 */
interface ListingSurface {
  name: string;
  module: string;
  ids: () => Promise<string[]>;
}

const surfaces: ListingSurface[] = [
  {
    name: "the projects REST list",
    module:
      "src/server/app-layer/projects/repositories/project.prisma.repository.ts",
    ids: async () => {
      const page = await new PrismaProjectRepository(
        prisma,
      ).findAllByOrganization({ organizationId, page: 1, limit: 100 });
      return page.data.map((p) => p.id);
    },
  },
  {
    name: "the organization project tree behind the project selector",
    module:
      "src/server/app-layer/organizations/repositories/organization.prisma.repository.ts",
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
    module: "src/server/teams/team.service.ts",
    ids: async () => {
      const teams = await new TeamService({ prisma }).getTeamsWithRoleBindings({
        organizationId,
      });
      return teams.flatMap((t) => t.projects.map((p) => p.id));
    },
  },
  {
    name: "the API-key scope picker",
    module: "src/server/api-key/api-key.repository.ts",
    ids: async () => {
      const projects = await ApiKeyRepository.create(prisma).findProjectsInOrg({
        organizationId,
      });
      return projects.map((p) => p.id);
    },
  },
  {
    name: "the plan-limit alert's per-project lines",
    module:
      "src/server/app-layer/organizations/repositories/organization.prisma.repository.ts",
    ids: async () => {
      const projects = await new PrismaOrganizationRepository(
        prisma,
      ).findProjectsWithName(organizationId);
      return projects.map((p) => p.id);
    },
  },
  {
    name: "the data-privacy scope picker",
    module: "src/server/data-privacy/dataPrivacyPolicy.read.ts",
    ids: async () => {
      const snapshot = await getDataPrivacySnapshot(readCtx(), {
        projectId: applicationProjectId,
      });
      return snapshot.available.projects.map((p) => p.id);
    },
  },
  {
    name: "the data-retention scope picker",
    module: "src/server/data-retention/policy/dataRetentionPolicy.read.ts",
    ids: async () => {
      const snapshot = await getRetentionPolicySnapshot(readCtx(), {
        projectId: applicationProjectId,
      });
      return snapshot.available.projects.map((p) => p.id);
    },
  },
  {
    name: "the model-defaults scope picker",
    module: "src/server/modelProviders/modelDefaults.read.ts",
    ids: async () => {
      const snapshot = await getDefaultModelsSnapshot(readCtx(), {
        projectId: applicationProjectId,
      });
      return snapshot.available.projects.map((p) => p.id);
    },
  },
  {
    name: "department assignment",
    module: "ee/governance/services/department/department.service.ts",
    ids: async () => {
      const assignments = await DepartmentService.create(prisma).getAssignments(
        { organizationId },
      );
      return assignments.projects.map((p) => p.id);
    },
  },
  {
    name: "the caller project scope map",
    module: "src/server/organizations/resolveCallerProjectScope.ts",
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
    module: "src/server/api/routers/costs.ts",
    ids: async () => {
      const rows = await caller.costs.getAggregatedCostsForOrganization({
        organizationId,
        startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
        endDate: Date.now(),
      });
      return rows.map((r) => r.project.id);
    },
  },
  {
    name: "the team's projects REST list",
    module: "src/server/app-layer/teams/repositories/team.prisma.repository.ts",
    ids: async () => {
      const projects = await new TeamRestService(
        new PrismaTeamRepository(prisma),
      ).listProjects({ teamId });
      return projects.map((p) => p.id);
    },
  },
];

/**
 * Source roots the registration sweep reads, relative to `platform/app`.
 *
 * `import.meta.dirname` is `src/server/__tests__`, so the package root is
 * three levels up — resolved rather than hardcoded so moving this file does
 * not silently point the sweep at nothing.
 */
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..");
const SWEPT_ROOTS = ["src", "ee"];

/**
 * The predicate that hides the governance home, in either spelling.
 *
 * Matched as text rather than through the query it sits in, because the same
 * predicate reaches Prisma three different ways here — inline in a
 * `findMany`, hoisted into a shared `where` const, and nested inside a team's
 * `projects` include. A matcher anchored on `findMany` sees only the first,
 * which is how a filtered listing could stay off this registry while looking
 * swept.
 */
const GOVERNANCE_EXCLUSION =
  /not:\s*(?:"internal_governance"|PROJECT_KIND\.INTERNAL_GOVERNANCE)/;

/**
 * Reads that carry the predicate but hand the caller no project id, so there
 * is nothing for a member to see and nothing for a surface to drive. Listed
 * one by one rather than pattern-matched: an entry here is a claim somebody
 * made deliberately, and a new listing cannot join it by accident.
 */
const NOT_A_LISTING: Record<string, string> = {
  "src/server/gateway/scopeResolver.ts":
    "counts the alternatives to the governance project when resolving a key's trace destination; returns a number",
  "ee/governance/services/setupState.service.ts":
    "counts application projects that have ingested, to decide one onboarding flag; returns a number",
};

/** Every source file that hides the governance home from a project read. */
function modulesFilteringTheGovernanceHome(): string[] {
  const found: string[] = [];
  for (const root of SWEPT_ROOTS) {
    for (const file of walkTypeScript(path.join(PACKAGE_ROOT, root))) {
      if (GOVERNANCE_EXCLUSION.test(fs.readFileSync(file, "utf8"))) {
        found.push(path.relative(PACKAGE_ROOT, file));
      }
    }
  }
  return found.sort();
}

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "generated") continue;
      yield* walkTypeScript(full);
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    if (entry.name.includes(".test.")) continue;
    yield full;
  }
}

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

    describe("when a new project listing is added to the codebase", () => {
      /** @scenario "Every filtered project listing is a surface the leak gate drives" */
      it("fails unless the listing registers itself as a driven surface", () => {
        const filtering = modulesFilteringTheGovernanceHome();

        // The sweep's own guard: a walker that found nothing, or a regex that
        // stopped matching the predicate, would otherwise report a clean
        // registry while looking at zero readers.
        expect(filtering).toContain(
          "src/server/app-layer/projects/repositories/project.prisma.repository.ts",
        );

        const registered = new Set(surfaces.map((s) => s.module));
        const unaccounted = filtering.filter(
          (m) => !registered.has(m) && !(m in NOT_A_LISTING),
        );

        expect(
          unaccounted,
          "these readers filter the governance home but no surface above drives them, so nothing proves they keep filtering it",
        ).toEqual([]);

        // And the other direction: a surface naming a module that no longer
        // filters is a surface pointed at the wrong reader.
        const stale = [...registered].filter((m) => !filtering.includes(m));
        expect(
          stale,
          "registered surfaces whose module no longer filters",
        ).toEqual([]);
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
