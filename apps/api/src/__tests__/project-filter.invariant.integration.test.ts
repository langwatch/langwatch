/**
 * Leak gate (ADR-128, ADR-177): the governance home is listed to nobody, an aggregate to admins.
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
let aggregateProjectId: string;
const people: {
  who: string;
  role: "MEMBER" | "DEVELOPER" | "EXTERNAL";
  session?: LiveSession;
}[] = [
  { who: "a member who is not an admin", role: "MEMBER" },
  { who: "a member holding only a Developer seat", role: "DEVELOPER" },
  { who: "an external collaborator", role: "EXTERNAL" },
];

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
        await api.application
          .service(ProjectApi)
          .findProjectsWithDepartments({ organizationId, hiddenKinds: [] })
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
    module: PROJECT_REPOSITORY,
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

/** Hides the governance home and nothing else, so it lists the aggregate to whoever reaches it. */
const GOVERNANCE_ONLY_EXCLUSION =
  /kind:\s*\{\s*not:\s*(?:"internal_governance"|PROJECT_KIND\.INTERNAL_GOVERNANCE)\s*\}/g;

/** Allowed governance-only filters, counted per file, and why no non-admin meets the aggregate. */
const AGGREGATE_FILTERED_ELSEWHERE: Record<string, { count: number; reason: string }> = {
  [MEMBERSHIP_REPOSITORY]: {
    count: 1,
    reason:
      "organization-visibility.service.ts drops projectKindsHiddenFrom(role) per organisation after the one query",
  },
  "modules/data-privacy/process/src/repositories/prisma/prisma.data-privacy-directory.repository.ts":
    {
      count: 1,
      reason:
        "the snapshot keeps only projects the project:update batch admits, and the batch closes the aggregate to a non-admin",
    },
  "modules/data-retention/process/src/repositories/prisma/prisma.data-retention-directory.repository.ts":
    {
      count: 1,
      reason:
        "as data-privacy: data-retention-snapshot.service.ts offers only projects project:update admits; main's dataRetentionPolicy.read.ts kept this filter",
    },
  "modules/entitlement/process/src/repositories/prisma/prisma.organization-spend.repository.ts": {
    count: 1,
    reason:
      "the team-member branch adds kind: { not: aggregate }; only the organisation ADMIN branch reaches it, as main's costs.ts",
  },
  [SCOPE_GRAPH_REPOSITORY]: {
    count: 1,
    reason: "scope-graph-visibility.rules.ts drops projectKindsHiddenFrom(role) per organisation",
  },
  [PROJECT_REPOSITORY]: {
    count: 4,
    reason:
      "two counts, plus findAllByTeam and findLiveNonGovernanceIds: id sets for provider and agent lookups, never a listing; main's aiToolEntry.service.ts and modelDefaults.read.ts list every kind",
  },
};

function governanceOnlyFiltersByModule(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const root of SWEPT_ROOTS) {
    for (const file of walkTypeScript(path.join(REPOSITORY_ROOT, root))) {
      const count = fs.readFileSync(file, "utf8").match(GOVERNANCE_ONLY_EXCLUSION)?.length ?? 0;
      if (count > 0) found[path.relative(REPOSITORY_ROOT, file)] = count;
    }
  }
  return found;
}

/** The listings whose answer depends on the asker's organisation role, as that person. */
function roleAwareListings({ session }: { session: LiveSession }) {
  const ids = async ({
    procedure,
    input,
    pick,
  }: {
    procedure: string;
    input: unknown;
    pick: (data: unknown) => string[];
  }): Promise<string[] | "refused"> => {
    const answer = await callTrpc({ api, path: procedure, kind: "query", input, session });
    if (answer.status === 401 || answer.status === 403) return "refused";
    if (answer.status !== 200) {
      throw new Error(`${procedure} answered ${answer.status}: ${answer.body.slice(0, 300)}`);
    }
    return pick(answer.data);
  };
  const treeIds = (data: unknown) =>
    nestedTeams
      .parse(data)
      .filter((organization) => organization.id === organizationId)
      .flatMap((organization) => organization.teams.flatMap((team) => team.projects))
      .map((project) => project.id);
  return [
    {
      name: "the organization project tree behind the project selector",
      ids: () => ids({ procedure: "organization.getAll", input: {}, pick: treeIds }),
    },
    {
      name: "the shell's scope graph",
      ids: () => ids({ procedure: "organization.getScopeGraph", input: {}, pick: treeIds }),
    },
    {
      name: "team and RBAC settings",
      ids: () =>
        ids({
          procedure: "team.getTeamsWithGrants",
          input: { organizationId },
          pick: (data) =>
            z
              .array(withProjects)
              .parse(data)
              .flatMap((team) => team.projects.map((project) => project.id)),
        }),
    },
    {
      name: "department assignment",
      ids: () =>
        ids({
          procedure: "departments.assignments",
          input: { organizationId },
          pick: (data) => withProjects.parse(data).projects.map((project) => project.id),
        }),
    },
    {
      name: "cost by project",
      ids: () =>
        ids({
          procedure: "costs.getAggregatedCostsForOrganization",
          input: {
            organizationId,
            startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
            endDate: Date.now(),
          },
          pick: (data) =>
            z
              .array(z.looseObject({ project: withId }))
              .parse(data)
              .map((row) => row.project.id),
        }),
    },
  ];
}

async function seatPeopleOnTheTeam(): Promise<void> {
  // Non-admins on the aggregate's own team, each holding the strongest team grant, so whatever
  // keeps the aggregate from them is the admin-only rule and not a missing grant.
  for (const person of people) {
    const session = await signUpSession({ api, label: `gov-leak-${person.role.toLowerCase()}` });
    person.session = session;
    await prisma.organizationUser.create({
      data: { userId: session.userId, organizationId, role: person.role },
    });
    await prisma.teamUser.create({ data: { userId: session.userId, teamId, role: "ADMIN" } });
    await prisma.grant.create({
      data: {
        id: `grant-team-${person.role.toLowerCase()}-${ns}`,
        organizationId,
        principalType: "USER",
        principalId: session.userId,
        roleKey: "admin",
        source: "grants-service",
        scopeType: "TEAM",
        scopeId: teamId,
        occurredAt: new Date(),
      },
    });
  }
}

/** Where a person is listed the aggregate, and where they miss even the control project. */
async function aggregateSightings({ session, role }: { session: LiveSession; role: string }) {
  const leaked: string[] = [];
  const blind: string[] = [];
  for (const surface of roleAwareListings({ session: session })) {
    const ids = await surface.ids();
    if (ids === "refused") continue;
    // A Developer seat sees no shared project in the selector, so it has no control project.
    if (role !== "DEVELOPER" && !ids.includes(applicationProjectId)) {
      blind.push(surface.name);
    }
    if (ids.includes(aggregateProjectId)) leaked.push(surface.name);
  }
  return { blind, leaked };
}

describe("when a listing hides only the governance home", () => {
  it("fails unless every such listing is allow-listed with why the aggregate cannot reach a non-admin", () => {
    const found = governanceOnlyFiltersByModule();
    // The sweep's own guard: a regex that stopped matching would report every file clean.
    expect(Object.keys(found)).toContain(MEMBERSHIP_REPOSITORY);

    const unexplained = Object.entries(found)
      .filter(([module, count]) => AGGREGATE_FILTERED_ELSEWHERE[module]?.count !== count)
      .map(([module, count]) => `${module} (${count})`);
    expect(
      unexplained,
      "these files hide only the governance project, so a non-admin would be listed the aggregate: filter with projectKindsHiddenFrom(role), or record why the aggregate cannot reach a non-admin there",
    ).toEqual([]);

    const stale = Object.keys(AGGREGATE_FILTERED_ELSEWHERE).filter((module) => !(module in found));
    expect(stale, "allow-listed files that no longer hide only the governance project").toEqual([]);
  });
});

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
    aggregateProjectId = (await project({ slug: "agg", kind: "aggregate" })).id;

    await seatPeopleOnTheTeam();

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
      data: [...both, aggregateProjectId].map((projectId) => ({
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
    const inProjects = {
      projectId: { in: [applicationProjectId, governanceProjectId, aggregateProjectId] },
    };
    await prisma.cost.deleteMany({ where: inProjects });
    await prisma.agent.deleteMany({ where: inProjects });
    await prisma.projectSecret.deleteMany({ where: inProjects });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.apiKey.deleteMany({ where: { organizationId } });
    await prisma.teamUser.deleteMany({ where: { teamId } });
    await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
    await removeSignedUpRows({
      prisma,
      userIds: [
        member.userId,
        ...people.flatMap((person) => (person.session ? [person.session.userId] : [])),
      ],
      organizationIds: [organizationId],
    });
    await api?.close();
    await connection?.closeOnce();
  });

  describe("given an organization holding both a real project and its governance home", () => {
    describe("when every listing surface is swept at once", () => {
      /** @scenario "The Lane-B suite asserts every Project consumer filters out internal governance projects" */
      /** @scenario "The governance home never appears anywhere members list projects" */
      it("keeps the home out of every member-facing listing surface", async () => {
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
        expect({ blind, leaked }).toEqual({ blind: [], leaked: [] });
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
          .map((surface) => surface.module)
          .filter((module) => !filtering.includes(module));
        expect(stale, "registered surfaces whose module no longer filters").toEqual([]);
      });
    });
  });

  describe("given an aggregate project on a team whose members are not organization admins", () => {
    it.each(people)("keeps it out of every project list $who can open", async (person) => {
      if (!person.session) throw new Error(`${person.who} was never signed up`);
      expect(await aggregateSightings({ session: person.session, role: person.role })).toEqual({
        blind: [],
        leaked: [],
      });
    });

    it("lists it to an organization admin on the same surfaces", async () => {
      for (const surface of roleAwareListings({ session: member })) {
        expect(await surface.ids(), surface.name).toContain(aggregateProjectId);
      }
    });
  });
});
