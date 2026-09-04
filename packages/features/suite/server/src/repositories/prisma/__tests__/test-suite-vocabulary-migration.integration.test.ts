/**
 * @vitest-environment node
 *
 * The migration that carries the stored vocabulary forward, run against real
 * data.
 *
 * It has two halves. The schema half renames `"Scenario"."folderId"` to
 * `"testSuiteId"`, renames the index over it and changes the `kind` default;
 * those statements run once and cannot be replayed, so they are read back off
 * the live database instead. The data half rewrites the suite kinds and the
 * plan scope modes; those statements are replayed here, over rows seeded with
 * the values they had before, inside a transaction that is rolled back.
 *
 * Ported from
 * platform/app/src/server/suites/__tests__/test-suite-vocabulary-migration.integration.test.ts
 * (origin/main), adapted to the split feature-package architecture: this
 * package has no dedicated `test:integration` lane, so — following the
 * precedent set by `plan-identity.integration.test.ts` in this same
 * package — the suite skips itself when `DATABASE_URL` is absent.
 *
 * @see specs/suites/test-suites.feature
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
    throw new Error("DATABASE_URL is required for the vocabulary migration integration test");
  }
  return connection.client;
}

/** The data half's statements, read straight off the shipped migration. */
const dataStatements = databaseUrl
  ? migrationStatements({
      nameSuffix: "_test_suite_vocabulary",
      carryVocabularyForward: false,
    }).filter((statement) => statement.includes("UPDATE "))
  : [];

const namespace = `test-suite-vocabulary-${randomUUID()}`;
let organizationId = "";
let teamId = "";
const projectIds = {
  kinds: `${namespace}-kinds`,
  scopes: `${namespace}-scopes`,
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

/** A suite row written with the values it would have held before the migration. */
async function createSuiteRow(params: {
  projectId: string;
  name: string;
  kind: string;
  scope?: Prisma.InputJsonValue;
}) {
  return database().simulationSuite.create({
    data: {
      projectId: params.projectId,
      name: params.name,
      slug: `${params.name.toLowerCase().replace(/\s+/g, "-")}-${randomUUID().slice(0, 6)}`,
      kind: params.kind,
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
      ...(params.scope && { scope: params.scope }),
    },
  });
}

/** A sentinel thrown to roll the migration's writes back. */
class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

/**
 * Runs the data half, hands the caller a transaction client to read what it
 * wrote, then rolls every one of its writes back.
 */
async function withMigrationApplied<T>(
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    await database().$transaction(
      async (tx) => {
        for (const statement of dataStatements) {
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

describe.skipIf(!databaseUrl)("The stored test suite vocabulary", () => {
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
        await database().scenario.deleteMany({ where: { projectId } });
        await database().simulationSuite.deleteMany({ where: { projectId } });
        await database().project.deleteMany({ where: { id: projectId } });
      }
      if (teamId) await database().team.deleteMany({ where: { id: teamId } });
      if (organizationId) await database().organization.deleteMany({ where: { id: organizationId } });
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given the database the migration has run on", () => {
    /** @scenario "The scenario column names the test suite it is filed in" */
    it("names the column testSuiteId and the index after it", async () => {
      const columns = await database().$queryRaw<{ column_name: string }[]>`
        -- @tenancy: reads the catalog, which holds no project row
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'Scenario' AND column_name IN ('folderId', 'testSuiteId')
      `;
      expect(columns.map((row) => row.column_name)).toEqual(["testSuiteId"]);

      const indexes = await database().$queryRaw<{ indexname: string }[]>`
        -- @tenancy: reads the catalog, which holds no project row
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'Scenario'
          AND indexname IN ('Scenario_projectId_folderId_idx', 'Scenario_projectId_testSuiteId_idx')
      `;
      expect(indexes.map((row) => row.indexname)).toEqual(["Scenario_projectId_testSuiteId_idx"]);
    });
  });

  describe("given suite rows stored under the old kinds", () => {
    /** @scenario "The stored suite kinds are test_suite and run_plan" */
    it("reads them back as test_suite and run_plan, and defaults to run_plan", async () => {
      const projectId = projectIds.kinds;
      const grouping = await createSuiteRow({ projectId, name: "Refunds", kind: "folder" });
      const plan = await createSuiteRow({ projectId, name: "Nightly", kind: "custom" });

      const rows = await withMigrationApplied((tx) =>
        tx.simulationSuite.findMany({
          where: { projectId },
          select: { id: true, kind: true },
        }),
      );

      const kindOf = new Map(rows.map((row) => [row.id, row.kind]));
      expect(kindOf.get(grouping.id)).toBe("test_suite");
      expect(kindOf.get(plan.id)).toBe("run_plan");

      const [column] = await database().$queryRaw<{ column_default: string }[]>`
        -- @tenancy: reads the catalog, which holds no project row
        SELECT column_default FROM information_schema.columns
        WHERE table_name = 'SimulationSuite' AND column_name = 'kind'
      `;
      expect(column?.column_default).toContain("run_plan");
    });
  });

  describe("given plans stored under the old scope modes", () => {
    /** @scenario "The stored scope modes are test_suites and scenarios" */
    it("rewrites the modes and the id list, and leaves a null scope alone", async () => {
      const projectId = projectIds.scopes;
      const overSuites = await createSuiteRow({
        projectId,
        name: "Over suites",
        kind: "custom",
        scope: { mode: "folders", folderIds: ["suite_a", "suite_b"] },
      });
      const overList = await createSuiteRow({
        projectId,
        name: "Over a list",
        kind: "custom",
        scope: { mode: "cases" },
      });
      const overLabels = await createSuiteRow({
        projectId,
        name: "Over labels",
        kind: "custom",
        scope: { mode: "labels", labels: ["checkout"] },
      });
      const noScope = await createSuiteRow({ projectId, name: "No scope", kind: "custom" });

      const rows = await withMigrationApplied((tx) =>
        tx.simulationSuite.findMany({
          where: { projectId },
          select: { id: true, scope: true },
        }),
      );

      const scopeOf = new Map(rows.map((row) => [row.id, row.scope]));
      expect(scopeOf.get(overSuites.id)).toEqual({
        mode: "test_suites",
        testSuiteIds: ["suite_a", "suite_b"],
      });
      expect(scopeOf.get(overList.id)).toEqual({ mode: "scenarios" });
      expect(scopeOf.get(overLabels.id)).toEqual({ mode: "labels", labels: ["checkout"] });
      expect(scopeOf.get(noScope.id)).toBeNull();
    });
  });
});
