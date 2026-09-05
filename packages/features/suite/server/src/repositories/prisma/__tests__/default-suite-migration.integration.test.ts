/**
 * @vitest-environment node
 * @see specs/suites/default-suite.feature
 */
import { randomUUID } from "node:crypto";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationStatements } from "./replay-migration";

class AllowTestQueries extends PrismaQueryGuard {
  execute(_context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(_context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("LANGWATCH_TEST_DATABASE_URL is required for the default suite migration test");
  }
  return connection.client;
}

const statements = databaseUrl ? migrationStatements({ nameSuffix: "_default_suite" }) : [];

const namespace = `default-suite-migration-${randomUUID()}`;
let teamId = "";
let organizationId = "";

async function createProject(projectId: string) {
  await database().project.create({
    data: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-${projectId}`,
      teamId,
      language: "en",
      framework: "test",
    },
  });
}

async function createScenario(params: {
  projectId: string;
  name: string;
  testSuiteId?: string;
  archived?: boolean;
}) {
  return database().scenario.create({
    data: {
      projectId: params.projectId,
      name: params.name,
      situation: "A customer asks for help",
      criteria: ["The agent helps"],
      labels: [],
      testSuiteId: params.testSuiteId,
      archivedAt: params.archived ? new Date() : null,
    },
  });
}

async function createSuite(params: {
  projectId: string;
  name: string;
  kind: "test_suite" | "run_plan";
}) {
  return database().simulationSuite.create({
    data: {
      projectId: params.projectId,
      name: params.name,
      slug: `${params.name.toLowerCase()}-${randomUUID().slice(0, 6)}`,
      kind: params.kind,
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
    },
  });
}

/** A sentinel thrown to roll the migration's writes back. */
class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

async function withMigrationApplied<T>(
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    await database().$transaction(
      async (tx) => {
        for (const statement of statements) {
          await tx.$executeRawUnsafe(statement);
        }
        throw new Rollback(await read(tx));
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
  } catch (error) {
    if (error instanceof Rollback) return error.value as T;
    throw error;
  }
  throw new Error("the migration transaction was not rolled back");
}

describe.skipIf(!databaseUrl)("The Default suite migration", () => {
  beforeAll(async () => {
    const db = database();
    const organization = await db.organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await db.team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    teamId = team.id;
  });

  afterAll(async () => {
    try {
      if (teamId) {
        const projects = await database().project.findMany({
          where: { teamId },
          select: { id: true },
        });
        const projectIds = projects.map((project) => project.id);
        await database().scenario.deleteMany({ where: { projectId: { in: projectIds } } });
        await database().simulationSuite.deleteMany({ where: { projectId: { in: projectIds } } });
        await database().project.deleteMany({ where: { teamId } });
        await database().team.deleteMany({ where: { id: teamId } });
      }
      if (organizationId)
        await database().organization.deleteMany({ where: { id: organizationId } });
    } finally {
      await connection?.closeOnce();
    }
  });

  /** @scenario "The migration files every unfiled active scenario into a new Default suite" */
  it("files every unfiled active scenario into a new Default suite and leaves filed ones alone", async () => {
    const projectId = `${namespace}-a`;
    await createProject(projectId);
    const refunds = await createSuite({ projectId, name: "Refunds", kind: "test_suite" });
    const filed = await createScenario({ projectId, name: "Filed", testSuiteId: refunds.id });
    const first = await createScenario({ projectId, name: "First" });
    const second = await createScenario({ projectId, name: "Second" });

    const result = await withMigrationApplied(async (tx) => {
      const defaultSuite = await tx.simulationSuite.findFirst({
        where: { projectId, name: "Default" },
      });
      const scenarios = await tx.scenario.findMany({
        where: { id: { in: [filed.id, first.id, second.id] } },
      });
      return { defaultSuite, scenarios };
    });

    expect(result.defaultSuite).toMatchObject({ kind: "test_suite" });
    const byId = new Map(result.scenarios.map((scenario) => [scenario.id, scenario]));
    expect(byId.get(first.id)?.testSuiteId).toBe(result.defaultSuite?.id);
    expect(byId.get(second.id)?.testSuiteId).toBe(result.defaultSuite?.id);
    expect(byId.get(filed.id)?.testSuiteId).toBe(refunds.id);
  });

  /** @scenario "The migration leaves archived scenarios unfiled" */
  it("leaves an archived scenario unfiled and creates no Default suite for it alone", async () => {
    const projectId = `${namespace}-b`;
    await createProject(projectId);
    const archived = await createScenario({ projectId, name: "Archived", archived: true });

    const result = await withMigrationApplied(async (tx) => {
      const defaultSuite = await tx.simulationSuite.findFirst({
        where: { projectId, name: "Default" },
      });
      const scenario = await tx.scenario.findFirst({ where: { id: archived.id } });
      return { defaultSuite, scenario };
    });

    expect(result.defaultSuite).toBeNull();
    expect(result.scenario?.testSuiteId).toBeNull();
  });

  /** @scenario "A project with no scenarios gets no Default suite" */
  it("creates no suite at all for a project that holds no scenario", async () => {
    const projectId = `${namespace}-c`;
    await createProject(projectId);

    const suites = await withMigrationApplied((tx) =>
      tx.simulationSuite.findMany({ where: { projectId } }),
    );

    expect(suites).toEqual([]);
  });

  /** @scenario "The new Default suite reports the scenarios filed into it" */
  it("reports every scenario it filed as a member of the new Default suite", async () => {
    const projectId = `${namespace}-d`;
    await createProject(projectId);
    const scenarios = await Promise.all(
      ["One", "Two", "Three"].map((name) => createScenario({ projectId, name })),
    );

    const defaultSuite = await withMigrationApplied((tx) =>
      tx.simulationSuite.findFirst({ where: { projectId, name: "Default" } }),
    );

    expect(new Set(defaultSuite?.scenarioIds)).toEqual(new Set(scenarios.map((s) => s.id)));
  });
});
