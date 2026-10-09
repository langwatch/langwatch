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
 * @see specs/suites/test-suites.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { migrationStatements } from "./replay-migration";

/**
 * The statements that rewrite rows.
 *
 * The migration is read with its own words kept, because its `WHERE` clauses
 * name the values it is replacing.
 */
const dataStatements = migrationStatements({
  nameSuffix: "_test_suite_vocabulary",
  carryVocabularyForward: false,
}).filter((statement) => statement.includes("UPDATE "));

const suffix = nanoid(8);
const projectIds = {
  kinds: `test-vocabulary-kinds-${suffix}`,
  scopes: `test-vocabulary-scopes-${suffix}`,
};

let teamId: string;

async function createProject(projectId: string) {
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId,
      language: "en",
      framework: "test",
    },
  });
}

/** A suite row written with the values it held before the migration. */
async function createSuiteRow(params: {
  projectId: string;
  name: string;
  kind: string;
  scope?: Prisma.InputJsonValue;
}) {
  return prisma.simulationSuite.create({
    data: {
      id: `suite_${nanoid()}`,
      projectId: params.projectId,
      name: params.name,
      slug: `${params.name.toLowerCase()}-${nanoid(6)}`,
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
    await prisma.$transaction(
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

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  teamId = team!.id;
  for (const projectId of Object.values(projectIds)) {
    await createProject(projectId);
  }
});

afterAll(async () => {
  for (const projectId of Object.values(projectIds)) {
    await prisma.scenario.deleteMany({ where: { projectId } });
    await prisma.simulationSuite.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
  }
});

describe("given the database the migration has run on", () => {
  /** @scenario "The scenario column names the test suite it is filed in" */
  it("names the column testSuiteId and the index after it", async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      -- @tenancy: reads the catalog, which holds no project row
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Scenario' AND column_name IN ('folderId', 'testSuiteId')
    `;
    expect(columns.map((row) => row.column_name)).toEqual(["testSuiteId"]);

    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      -- @tenancy: reads the catalog, which holds no project row
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Scenario'
        AND indexname IN ('Scenario_projectId_folderId_idx', 'Scenario_projectId_testSuiteId_idx')
    `;
    expect(indexes.map((row) => row.indexname)).toEqual([
      "Scenario_projectId_testSuiteId_idx",
    ]);
  });
});

describe("given suite rows stored under the old kinds", () => {
  /** @scenario "The stored suite kinds are test_suite and run_plan" */
  it("reads them back as test_suite and run_plan, and defaults to run_plan", async () => {
    const projectId = projectIds.kinds;
    const grouping = await createSuiteRow({
      projectId,
      name: "Refunds",
      kind: "folder",
    });
    const plan = await createSuiteRow({
      projectId,
      name: "Nightly",
      kind: "custom",
    });

    const rows = await withMigrationApplied((tx) =>
      tx.simulationSuite.findMany({
        where: { projectId },
        select: { id: true, kind: true },
      }),
    );

    const kindOf = new Map(rows.map((row) => [row.id, row.kind]));
    expect(kindOf.get(grouping.id)).toBe("test_suite");
    expect(kindOf.get(plan.id)).toBe("run_plan");

    const [column] = await prisma.$queryRaw<{ column_default: string }[]>`
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
    const noScope = await createSuiteRow({
      projectId,
      name: "No scope",
      kind: "custom",
    });

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
    expect(scopeOf.get(overLabels.id)).toEqual({
      mode: "labels",
      labels: ["checkout"],
    });
    expect(scopeOf.get(noScope.id)).toBeNull();
  });
});
