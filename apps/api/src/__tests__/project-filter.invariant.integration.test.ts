/**
 * The leak gate (ADR-128): no member-facing listing shows the governance home, driven live.
 * @vitest-environment node
 * @see specs/governance/pulled-rows-home-and-leak-gate.feature and governance/ui-contract.feature
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { API_KEY_PREFIX } from "@langwatch/api-key-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi } from "@langwatch/project-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  bootLiveApi,
  callTrpc,
  type LiveApi,
  type LiveSession,
  liveDatabaseUrl,
  liveStoresConfigured,
  removeSignedUpRows,
  signUpSession,
} from "./api-live.fixture.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const stores = liveStoresConfigured;
const connection = stores
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:project-filter-invariant"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = `gov-leak-${generate("test").toString().toLowerCase()}`;
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");

const withId = z.looseObject({ id: z.string() });
const withProjects = z.looseObject({ projects: z.array(withId) });
const nestedTeams = z.array(z.looseObject({ id: z.string(), teams: z.array(withProjects) }));
const available = z.looseObject({ available: withProjects });

/** One member-facing listing: the words a leak report uses, the reader it drives, the ids. */
type ListingSurface = { name: string; module: string; ids: () => Promise<string[]> };

let api: LiveApi;
let member: LiveSession;
let key: string;
let organizationId: string;
let teamId: string;
let applicationProjectId: string;
let governanceProjectId: string;

const query = async ({ procedure, input }: { procedure: string; input: unknown }) => {
  const answer = await callTrpc({ api, path: procedure, kind: "query", input, session: member });
  if (answer.status !== 200) {
    throw new Error(`${procedure} answered ${answer.status}: ${answer.body.slice(0, 300)}`);
  }
  return answer.data;
};

const rest = async ({ route }: { route: string }) => {
  const response = await api.fetch(route, { headers: { Authorization: `Bearer ${key}` } });
  const body = await response.text();
  if (response.status !== 200) throw new Error(`${route} answered ${response.status}: ${body}`);
  return JSON.parse(body) as unknown;
};

const PROJECT_REPOSITORY =
  "modules/project/process/src/repositories/prisma/prisma.project.repository.ts";
const MEMBERSHIP_REPOSITORY =
  "modules/organization/process/src/repositories/prisma/prisma.organization-membership.repository.ts";
const SCOPE_GRAPH_REPOSITORY =
  "modules/organization/process/src/repositories/prisma/prisma.scope-graph.repository.ts";

const surfaces: ListingSurface[] = [
  {
    name: "the projects REST list",
    module: PROJECT_REPOSITORY,
    ids: async () =>
      z
        .object({ data: z.array(withId) })
        .parse(await rest({ route: "/api/projects?limit=100" }))
        .data.map((project) => project.id),
  },
  {
    name: "the organization project tree behind the project selector",
    module: MEMBERSHIP_REPOSITORY,
    ids: async () =>
      nestedTeams
        .parse(await query({ procedure: "organization.getAll", input: {} }))
        .filter((organization) => organization.id === organizationId)
        .flatMap((organization) => organization.teams.flatMap((team) => team.projects))
        .map((project) => project.id),
  },
  {
    name: "the shell's scope graph",
    module: SCOPE_GRAPH_REPOSITORY,
    ids: async () =>
      nestedTeams
        .parse(await query({ procedure: "organization.getScopeGraph", input: {} }))
        .filter((organization) => organization.id === organizationId)
        .flatMap((organization) => organization.teams.flatMap((team) => team.projects))
        .map((project) => project.id),
  },
  {
    name: "team and RBAC settings",
    module: PROJECT_REPOSITORY,
    ids: async () =>
      z
        .array(withProjects)
        .parse(await query({ procedure: "team.getTeamsWithGrants", input: { organizationId } }))
        .flatMap((team) => team.projects.map((project) => project.id)),
  },
  {
    name: "the API-key scope picker",
    module: PROJECT_REPOSITORY,
    ids: async () =>
      z
        .array(withId)
        .parse(await query({ procedure: "apiKey.orgProjects", input: { organizationId } }))
        .map((project) => project.id),
  },
  {
    name: "the plan-limit alert's per-project lines",
    module: PROJECT_REPOSITORY,
    ids: async () =>
      (
        await api.application.service(ProjectApi).findProjectsWithDepartments({ organizationId })
      ).map((project) => project.id),
  },
  {
    name: "the data-privacy scope picker",
    module:
      "modules/data-privacy/process/src/repositories/prisma/prisma.data-privacy-directory.repository.ts",
    ids: async () =>
      available
        .parse(
          await query({
            procedure: "dataPrivacy.getSnapshot",
            input: { projectId: applicationProjectId },
          }),
        )
        .available.projects.map((project) => project.id),
  },
  {
    name: "the data-retention scope picker",
    module:
      "modules/data-retention/process/src/repositories/prisma/prisma.data-retention-directory.repository.ts",
    ids: async () =>
      available
        .parse(
          await query({
            procedure: "dataRetention.getRules",
            input: { projectId: applicationProjectId },
          }),
        )
        .available.projects.map((project) => project.id),
  },
  {
    name: "the model-defaults scope picker",
    module: "modules/model-provider/process/src/services/model-provider-scope.service.ts",
    ids: async () =>
      available
        .parse(
          await query({
            procedure: "modelProvider.getDefaultModelsForProject",
            input: { projectId: applicationProjectId },
          }),
        )
        .available.projects.map((project) => project.id),
  },
  {
    name: "department assignment",
    module: PROJECT_REPOSITORY,
    ids: async () =>
      withProjects
        .parse(await query({ procedure: "departments.assignments", input: { organizationId } }))
        .projects.map((project) => project.id),
  },
  {
    name: "cost by project",
    module:
      "modules/entitlement/process/src/repositories/prisma/prisma.organization-spend.repository.ts",
    ids: async () =>
      z
        .array(z.looseObject({ project: withId }))
        .parse(
          await query({
            procedure: "costs.getAggregatedCostsForOrganization",
            input: {
              organizationId,
              startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
              endDate: Date.now(),
            },
          }),
        )
        .map((row) => row.project.id),
  },
  {
    name: "the team's projects REST list",
    module: PROJECT_REPOSITORY,
    ids: async () => {
      const body = await rest({ route: `/api/teams/${teamId}/projects` });
      const rows = z.union([z.array(withId), z.object({ data: z.array(withId) })]).parse(body);
      return (Array.isArray(rows) ? rows : rows.data).map((project) => project.id);
    },
  },
  {
    // Hands back agents, not projects: the ids are recovered from the rows it returned.
    name: "the governance agents inventory",
    module: PROJECT_REPOSITORY,
    ids: async () => {
      const agents = z
        .array(withId)
        .parse(await query({ procedure: "governanceAgents.list", input: { organizationId } }));
      const rows = await prisma.agent.findMany({
        where: { id: { in: agents.map((agent) => agent.id.replace(/^registered:/, "")) } },
        select: { projectId: true },
      });
      return [...new Set(rows.map((row) => row.projectId))];
    },
  },
];

/** The predicate that hides the governance home, in each spelling a reader uses here. */
const GOVERNANCE_EXCLUSION =
  /not:\s*(?:"internal_governance"|PROJECT_KIND\.INTERNAL_GOVERNANCE)|kind\s*!==\s*PROJECT_KIND\.INTERNAL_GOVERNANCE|kind\s*===\s*PROJECT_KIND\.INTERNAL_GOVERNANCE\)\s*continue/;
const SWEPT_ROOTS = ["modules", "enterprise/modules"];

/** Readers carrying the predicate that hand a member no listing; each a deliberate claim. */
const NOT_A_LISTING: Record<string, string> = {
  "modules/project/process/src/repositories/memory/memory.project.repository.ts":
    "the memory twin: the listings it stands in for are driven here through the Prisma repository",
};

/** Filtering readers no live surface reaches here, each with the test that proves it filters. */
const PROVEN_ELSEWHERE: Record<string, string> = {
  "modules/analytics/process/src/services/langwatch-ql-query-scope.service.ts":
    "modules/analytics/process/src/services/__tests__/langwatch-ql-query-scope.unit.test.ts",
};

/**
 * Surfaces that list the home today although main filtered it: held, not fixed, by the lane
 * that restored this gate (handoff a-billing-governance §11). Pinned both ways: a new leak
 * fails, and so does a fixed one until its line here goes.
 */
const HELD_LEAKS: Record<string, string> = {
  "the data-privacy scope picker": "its directory reads projects with no kind filter",
  "the data-retention scope picker": "its directory reads projects with no kind filter",
  "the model-defaults scope picker":
    "it lists ProjectApi.listIdsByOrganization, which keeps the home",
  "cost by project": "the spend rollup reads projects with no kind filter",
};

/** Bounded: it catches a filtering reader that stops, not a new reader that never filtered. */
function modulesFilteringTheGovernanceHome(): string[] {
  const found: string[] = [];
  for (const root of SWEPT_ROOTS) {
    for (const file of walkTypeScript(path.join(REPOSITORY_ROOT, root))) {
      if (GOVERNANCE_EXCLUSION.test(fs.readFileSync(file, "utf8"))) {
        found.push(path.relative(REPOSITORY_ROOT, file));
      }
    }
  }
  return found.toSorted();
}

function* walkTypeScript(directory: string): Generator<string> {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["__tests__", "generated", "dist", "node_modules"].includes(entry.name)) continue;
      yield* walkTypeScript(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
    yield full;
  }
}

/** POSTs the application project with the organization key; waits until its scope folded. */
async function createApplicationProject(): Promise<string> {
  const response = await api.fetch("/api/projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Project app ${ns}`,
      teamId,
      language: "typescript",
      framework: "other",
    }),
  });
  const body = await response.text();
  if (response.status !== 201)
    throw new Error(`project create answered ${response.status}: ${body}`);
  const { id } = withId.parse(JSON.parse(body));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshot = await callTrpc({
      api,
      path: "dataPrivacy.getSnapshot",
      kind: "query",
      input: { projectId: id },
      session: member,
    });
    if (snapshot.status === 200) return id;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the application project's scope never folded");
}

/** One surface by the name it declares, so inserting a surface re-points nothing. */
function surfaceNamed({ name }: { name: string }): ListingSurface {
  const surface = surfaces.find((candidate) => candidate.name === name);
  if (!surface) throw new Error(`No listing surface named "${name}"; was it renamed?`);
  return surface;
}

describe.skipIf(!stores)("the hidden governance project as a member sees it", () => {
  beforeAll(async () => {
    api = await bootLiveApi({ withWorker: true });
    member = await signUpSession({ api, label: "gov-leak" });
    const organization = await prisma.organization.create({
      data: { name: `Leak Gate ${ns}`, slug: `--test-org-${ns}`, license: null },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: `Leak Gate ${ns}`, slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;
    const project = ({ slug, kind }: { slug: string; kind: string }) =>
      prisma.project.create({
        data: {
          name: `Project ${slug} ${ns}`,
          slug: `--proj-${slug}-${ns}`,
          apiKey: `--test-key-${slug}-${ns}`,
          teamId,
          language: "typescript",
          framework: "other",
          kind,
        },
      });
    governanceProjectId = (await project({ slug: "gov", kind: "internal_governance" })).id;

    // ADMIN at every level a surface reads, so no surface comes back empty for a permission reason.
    await prisma.organizationUser.create({
      data: { userId: member.userId, organizationId, role: "ADMIN" },
    });
    await prisma.teamUser.create({ data: { userId: member.userId, teamId, role: "ADMIN" } });
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organizationId,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    const lookupId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const apiKey = await prisma.apiKey.create({
      data: {
        name: `leak gate ${ns}`,
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        permissionMode: "all",
        userId: member.userId,
        createdByUserId: member.userId,
        organizationId,
      },
    });
    key = `${API_KEY_PREFIX}${lookupId}_${secret}`;
    for (const [principalType, principalId] of [
      ["USER", member.userId],
      ["API_KEY", apiKey.id],
    ] as const) {
      await prisma.grant.create({
        data: {
          id: `grant-${principalType.toLowerCase()}-${ns}`,
          organizationId,
          principalType,
          principalId,
          roleKey: "admin",
          source: "grants-service",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          occurredAt: new Date(),
        },
      });
    }

    // Created through the product rather than written, so the folds a picker reads (the
    // data-privacy project scope among them) land for it as they would for a member's project.
    applicationProjectId = await createApplicationProject();

    // Spend and a connected agent on both projects, or their listings would exclude the home
    // for want of a row rather than by the safeguard.
    const both = [applicationProjectId, governanceProjectId];
    await prisma.cost.createMany({
      data: both.map((projectId) => ({
        projectId,
        costType: "TRACE_CHECK" as const,
        referenceType: "CHECK" as const,
        referenceId: `check-${projectId}`,
        costName: "leak gate",
        amount: 1.5,
        currency: "USD",
      })),
    });
    await prisma.agent.createMany({
      data: both.map((projectId) => ({
        projectId,
        name: `leak gate ${projectId}`,
        type: "connected",
        config: { sdk: { name: "langwatch", version: "0.0.0", language: "typescript" } },
        lastSeenAt: null,
      })),
    });
  }, 180_000);

  afterAll(async () => {
    if (!prisma) return;
    const inProjects = { projectId: { in: [applicationProjectId, governanceProjectId] } };
    await prisma.cost.deleteMany({ where: inProjects });
    await prisma.agent.deleteMany({ where: inProjects });
    await prisma.projectSecret.deleteMany({ where: inProjects });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.apiKey.deleteMany({ where: { organizationId } });
    await prisma.teamUser.deleteMany({ where: { teamId } });
    await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
    await removeSignedUpRows({
      prisma,
      userIds: [member.userId],
      organizationIds: [organizationId],
    });
    await api?.close();
    await connection?.closeOnce();
  });

  describe("given an organization holding both a real project and its governance home", () => {
    describe("when every listing surface is swept at once", () => {
      /** @scenario "The Lane-B suite asserts every Project consumer filters out internal governance projects" */
      it("keeps the home out of every member-facing listing surface but the held leaks", async () => {
        // The other end of the guard: unfiltered, the home IS in this organization's projects.
        const unfiltered = await prisma.project.findMany({
          where: { team: { organizationId } },
          select: { id: true },
        });
        expect(unfiltered.map((project) => project.id)).toEqual(
          expect.arrayContaining([applicationProjectId, governanceProjectId]),
        );

        const leaked: string[] = [];
        const blind: string[] = [];
        for (const surface of surfaces) {
          const ids = await surface.ids();
          if (!ids.includes(applicationProjectId)) blind.push(surface.name);
          if (ids.includes(governanceProjectId)) leaked.push(surface.name);
        }

        // Blind first: a surface that showed nothing "excluded" the home for the wrong reason.
        expect({ blind, leaked }).toEqual({ blind: [], leaked: Object.keys(HELD_LEAKS) });
      });
    });

    describe("when the plan-limit alert is built", () => {
      it("keeps it out of the alert's per-project lines", async () => {
        const ids = await surfaceNamed({ name: "the plan-limit alert's per-project lines" }).ids();

        expect(ids).toContain(applicationProjectId);
        expect(ids).not.toContain(governanceProjectId);
      });
    });

    describe("when a new project listing is added to the codebase", () => {
      /** @scenario "Every filtered project listing is a surface the leak gate drives" */
      it("fails unless the listing registers itself as a driven surface", () => {
        const filtering = modulesFilteringTheGovernanceHome();
        expect(filtering).toContain(PROJECT_REPOSITORY);

        const registered = new Set(surfaces.map((surface) => surface.module));
        const unaccounted = filtering.filter(
          (module) =>
            !registered.has(module) && !(module in NOT_A_LISTING) && !(module in PROVEN_ELSEWHERE),
        );
        expect(
          unaccounted,
          "these readers filter the governance home but no surface above drives them",
        ).toEqual([]);

        const stale = surfaces
          .filter((surface) => !(surface.name in HELD_LEAKS))
          .map((surface) => surface.module)
          .filter((module) => !filtering.includes(module));
        expect(stale, "registered surfaces whose module no longer filters").toEqual([]);
      });
    });
  });
});
