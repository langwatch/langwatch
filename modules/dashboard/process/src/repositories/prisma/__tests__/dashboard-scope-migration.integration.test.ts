/**
 * @vitest-environment node
 * Real Postgres: the scope migration's backfill, replayed on one project's boards.
 * Spec: dashboards-v2.feature AC186.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dashboardScopeMigration } from "./dashboard-scope-migration.fixture.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("dashboard-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("DATABASE_URL is required for the migration replay");
  return connection.client;
}

const namespace = `dashboard-scope-migration-${randomUUID()}`;
let projectId = "";
let teamId = "";
let organizationId = "";

/** The shipped backfill, narrowed to this suite's project: the migration itself is blanket. */
function backfill(): string {
  const statement = dashboardScopeMigration().statements.find((sql) =>
    sql.startsWith('UPDATE "Dashboard"'),
  );
  if (statement === undefined) throw new Error("the migration carries no Dashboard backfill");
  return `${statement} AND "projectId" = $1`;
}

async function scopesByName(): Promise<Record<string, string>> {
  const rows = await database().dashboard.findMany({
    where: { projectId },
    select: { id: true, scope: true },
  });
  return Object.fromEntries(rows.map(({ id, scope }) => [id.replace(`${namespace}-`, ""), scope]));
}

describe.skipIf(!databaseUrl)("the board scope migration's backfill", () => {
  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    teamId = team.id;
    const project = await database().project.create({
      data: {
        name: namespace,
        slug: namespace,
        apiKey: namespace,
        teamId,
        language: "typescript",
        framework: "other",
      },
    });
    projectId = project.id;

    // As the boards stand once the column exists: every row at the default, Project.
    await database().dashboard.createMany({
      data: [
        { id: `${namespace}-reports`, projectId, name: "Reports", createdById: "member-1" },
        { id: `${namespace}-own`, projectId, name: "My dashboard", createdById: "member-1" },
        { id: `${namespace}-others`, projectId, name: "My dashboard", createdById: "member-2" },
        { id: `${namespace}-unowned`, projectId, name: "My dashboard" },
      ],
    });
  });

  afterAll(async () => {
    try {
      if (projectId) await cleanupTestRows(database(), [["dashboard", { projectId }]]);
      if (projectId) await database().project.delete({ where: { id: projectId } });
      if (teamId) await database().team.delete({ where: { id: teamId } });
      if (organizationId) await database().organization.delete({ where: { id: organizationId } });
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("when it runs over boards made before the scope column", () => {
    /** @scenario "AC186 Scope: the migration keeps today's audience" */
    it("keeps every board at Project except each member's own My dashboard", async () => {
      await database().$executeRawUnsafe(backfill(), projectId);

      expect(await scopesByName()).toEqual({
        reports: "PROJECT",
        own: "PRIVATE",
        others: "PRIVATE",
        unowned: "PROJECT",
      });
    });

    /** @scenario "AC186 Scope: the migration keeps today's audience" */
    it("changes no row on a second run", async () => {
      await database().$executeRawUnsafe(backfill(), projectId);

      const changed = await database().$executeRawUnsafe(backfill(), projectId);

      expect(changed).toBe(0);
    });
  });
});
