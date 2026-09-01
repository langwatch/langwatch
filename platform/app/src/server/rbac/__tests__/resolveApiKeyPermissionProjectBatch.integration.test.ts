/**
 * @vitest-environment node
 * @integration
 *
 * The api-key project ceiling at organization scale, on the authorization
 * engine. The per-project fan-out this batch replaced opened a collector pass
 * of several queries per project per permission; across the 50-project
 * organization that hit it in production, ~100 concurrent passes demanded the
 * whole Prisma connection pool at once and the v1 pull-request usage rollup
 * answered a 10-second P2024 500. The batch collects the key's grant snapshot
 * once and decides in memory, so its query count must not grow with the
 * project count — which is exactly what this suite pins, against a real
 * Postgres, by counting the queries.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  PrismaClient,
  type Team,
} from "~/generated/prisma/client";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "~/server/app-layer/authz/migration-name";
import { prisma } from "~/server/db";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import {
  resolveApiKeyPermission,
  resolveApiKeyPermissionProjectBatch,
} from "~/server/rbac/role-binding-resolver";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

const ns = nanoid(8);
const PROJECT_COUNT = 40;
const SMALL_COUNT = 5;

/** A synthetic key id: the engine decides from Grant rows, and a key with no
 *  ApiKey row resolves no owner — exactly a service key's shape. */
const apiKeyId = `apikey_${ns}`;

let organization: Organization;
let team: Team;
let projects: Array<{ projectId: string; teamId: string }>;

/** A client whose every query is counted; same database as the suite. */
let counting: PrismaClient;
let queryCount = 0;

async function queriesDuring(fn: () => Promise<unknown>): Promise<number> {
  const before = queryCount;
  await fn();
  return queryCount - before;
}

const batchFor = (targets: Array<{ projectId: string; teamId: string }>) =>
  resolveApiKeyPermissionProjectBatch({
    prisma: counting,
    apiKeyId,
    userId: null,
    organizationId: organization.id,
    projects: targets,
    permissions: ["traces:view", "cost:view"],
  });

beforeAll(async () => {
  counting = new PrismaClient({
    adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
    log: [{ emit: "event", level: "query" }],
  });
  counting.$on("query" as never, () => {
    queryCount += 1;
  });

  organization = await prisma.organization.create({
    data: { name: `ceiling-batch-${ns}`, slug: `--test-org-cb-${ns}` },
  });
  // On the engine BEFORE anything reads the gate for this organization: the
  // gate caches per subject, and a pre-finalize read would pin the legacy
  // path for a minute.
  await prisma.systemMigrationTenantState.create({
    data: {
      migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
      tenantId: organization.id,
      status: "finalized",
      occurredAt: new Date(),
    },
  });
  team = await prisma.team.create({
    data: {
      name: `ceiling-batch-${ns}`,
      slug: `--test-team-cb-${ns}`,
      organizationId: organization.id,
    },
  });
  const created = await Promise.all(
    Array.from({ length: PROJECT_COUNT }, (_, index) =>
      prisma.project.create({
        data: {
          id: `project_${nanoid()}`,
          name: `Scale ${index}`,
          slug: `--test-scale-${index}-${ns}`,
          language: "typescript",
          framework: "other",
          apiKey: `sk-lw-${nanoid(48)}`,
          teamId: team.id,
          isPersonal: false,
        },
      }),
    ),
  );
  projects = created.map((project) => ({
    projectId: project.id,
    teamId: team.id,
  }));

  // The key's one grant on the engine head: organization-wide admin, the
  // shape an org service key carries.
  await prisma.grant.create({
    data: {
      id: `grant_${ns}`,
      organizationId: organization.id,
      principalType: GrantPrincipalType.API_KEY,
      principalId: apiKeyId,
      roleKey: "admin",
      source: "migration",
      scopeType: GrantScopeType.ORGANIZATION,
      scopeId: organization.id,
      occurredAt: new Date(),
    },
  });
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["grant", { organizationId: organization.id }],
    ["systemMigrationTenantState", { tenantId: organization.id }],
    ["project", { teamId: team.id }],
    ["team", { id: team.id }],
    ["organization", { id: organization.id }],
  ]);
  await counting.$disconnect();
});

describe("Feature: The api-key project ceiling batches its grant reads", () => {
  describe("given an engine organization with dozens of projects and an org-wide service key grant", () => {
    describe("when the ceiling is resolved for every project and both permissions", () => {
      /** @scenario "A large organization's rollup is decided from one grant snapshot" */
      it("reads the same number of rows for dozens of projects as for a few", async () => {
        // Warm the per-organization engine-gate cache so the counted runs
        // compare decision reads, not one-time gate reads.
        await batchFor(projects.slice(0, 1));

        const forFew = await queriesDuring(() =>
          batchFor(projects.slice(0, SMALL_COUNT)),
        );
        const forMany = await queriesDuring(() => batchFor(projects));

        // The whole point of the batch: the snapshot is collected once, so
        // the project count buys pure in-memory decisions, not queries.
        expect(forMany).toBe(forFew);
        expect(forMany).toBeLessThanOrEqual(15);
      });

      it("answers every project for both permissions from the org-wide grant", async () => {
        const decisions = await batchFor(projects);

        for (const permission of ["traces:view", "cost:view"] as const) {
          const byProject = decisions.get(permission);
          expect(byProject?.size).toBe(PROJECT_COUNT);
          for (const { projectId } of projects) {
            expect(byProject?.get(projectId)).toBe(true);
          }
        }
      });

      it("answers exactly what the per-project check answers, at a fraction of the reads", async () => {
        const batched = await batchFor(projects);

        let fanOutQueries = 0;
        for (const { projectId, teamId } of projects) {
          fanOutQueries += await queriesDuring(async () => {
            const allowed = await resolveApiKeyPermission({
              prisma: counting,
              apiKeyId,
              userId: null,
              organizationId: organization.id,
              scope: { type: "project", id: projectId, teamId },
              permission: "traces:view",
            });
            expect(allowed).toBe(
              batched.get("traces:view")?.get(projectId) === true,
            );
          });
        }

        const batchedQueries = await queriesDuring(() => batchFor(projects));
        // The sequential fan-out this batch replaced pays per project; the
        // batch pays once. Logged so the contrast lands in the test output.
        console.log(
          `[ceiling-batch] ${PROJECT_COUNT} projects: per-project fan-out = ${fanOutQueries} queries, batch = ${batchedQueries} queries`,
        );
        expect(batchedQueries).toBeLessThan(fanOutQueries / 4);
      });
    });
  });
});
