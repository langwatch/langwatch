/**
 * @vitest-environment node
 * @see specs/suites/test-suite-run-plan-reuse.feature
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

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error(
      "DATABASE_URL is required for the execution settings migration integration test",
    );
  }
  return connection.client;
}

const statements = databaseUrl
  ? migrationStatements({ nameSuffix: "_folder_rows_hold_no_execution_settings" })
  : [];

const namespace = `test-suite-settings-${randomUUID()}`;
let teamId = "";
let organizationId = "";
const projectIds = {
  testSuites: `${namespace}-suites`,
  plans: `${namespace}-plans`,
};

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
      targets: [{ type: "http", referenceId: "agent_prod" }],
      repeatCount: 3,
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5-mini",
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

describe.skipIf(!databaseUrl)("The stored test suite execution settings", () => {
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
    for (const projectId of Object.values(projectIds)) {
      await createProject(projectId);
    }
  });

  afterAll(async () => {
    try {
      for (const projectId of Object.values(projectIds)) {
        await database().simulationSuite.deleteMany({ where: { projectId } });
        await database().project.deleteMany({ where: { id: projectId } });
      }
      if (teamId) await database().team.deleteMany({ where: { id: teamId } });
      if (organizationId)
        await database().organization.deleteMany({ where: { id: organizationId } });
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given a test suite row carrying execution settings", () => {
    /** @scenario "The stored execution settings are cleared off every test suite row" */
    it("clears its targets, repeat count and models", async () => {
      const projectId = projectIds.testSuites;
      const testSuite = await createSuite({ projectId, name: "Refunds", kind: "test_suite" });

      const migrated = await withMigrationApplied((tx) =>
        tx.simulationSuite.findFirst({ where: { id: testSuite.id, projectId } }),
      );

      expect(migrated?.targets).toEqual([]);
      expect(migrated?.repeatCount).toBe(1);
      expect(migrated?.simulatorModel).toBeNull();
      expect(migrated?.judgeModel).toBeNull();
    });

    it("leaves the row itself in place, name and members included", async () => {
      const projectId = projectIds.testSuites;
      const testSuite = await createSuite({ projectId, name: "Checkout", kind: "test_suite" });

      const migrated = await withMigrationApplied((tx) =>
        tx.simulationSuite.findFirst({ where: { id: testSuite.id, projectId } }),
      );

      expect(migrated?.name).toBe("Checkout");
      expect(migrated?.kind).toBe("test_suite");
      expect(migrated?.slug).toBe(testSuite.slug);
    });
  });

  describe("given a run plan carrying the same settings", () => {
    // A run plan row IS a run plan, and its stored configuration is what a
    // run of it executes, so the migration must not touch it.
    it("leaves its stored configuration alone", async () => {
      const projectId = projectIds.plans;
      const plan = await createSuite({ projectId, name: "Nightly", kind: "run_plan" });

      const migrated = await withMigrationApplied((tx) =>
        tx.simulationSuite.findFirst({ where: { id: plan.id, projectId } }),
      );

      expect(migrated?.targets).toEqual([{ type: "http", referenceId: "agent_prod" }]);
      expect(migrated?.repeatCount).toBe(3);
      expect(migrated?.simulatorModel).toBe("openai/gpt-5-mini");
      expect(migrated?.judgeModel).toBe("openai/gpt-5-mini");
    });
  });
});
