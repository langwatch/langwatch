/**
 * @vitest-environment node
 *
 * The migration that clears the execution settings off test suite rows, run
 * against real data.
 *
 * The migration is the half of "a test suite holds no execution settings"
 * that fixes what is already stored; `assertTestSuiteUpdate` in suite.service.ts
 * is the half that keeps new writes correct. This file runs the migration's
 * own SQL, read from the migration directory, so the rule under test is the
 * one that shipped and not a copy of it.
 *
 * The SQL touches every project of the database, so each test runs inside an
 * interactive transaction that is rolled back. The projects and suites are
 * seeded before it and cleaned up after; only the migration's writes are
 * discarded.
 *
 * @see specs/suites/test-suite-run-plan-reuse.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { migrationStatements } from "./replay-migration";

const statements = migrationStatements({
  nameSuffix: "_folder_rows_hold_no_execution_settings",
});
const suffix = nanoid(8);
/** One project per test, so a test never reads another's rows. */
const projectIds = {
  testSuites: `test-suite-settings-${suffix}`,
  plans: `test-suite-settings-plan-${suffix}`,
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

async function createSuite(params: {
  projectId: string;
  name: string;
  kind: "test_suite" | "run_plan";
}) {
  return prisma.simulationSuite.create({
    data: {
      id: `suite_${nanoid()}`,
      projectId: params.projectId,
      name: params.name,
      slug: `${params.name.toLowerCase()}-${nanoid(6)}`,
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

/**
 * Runs the migration, hands the caller a transaction client to read what it
 * wrote, then rolls every one of its writes back.
 */
async function withMigrationApplied<T>(
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    await prisma.$transaction(
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
    await prisma.simulationSuite.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
  }
});

describe("given a test suite row carrying execution settings", () => {
  /** @scenario "The stored execution settings are cleared off every test suite row" */
  it("clears its targets, repeat count and models", async () => {
    const projectId = projectIds.testSuites;
    const testSuite = await createSuite({
      projectId,
      name: "Refunds",
      kind: "test_suite",
    });

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
    const testSuite = await createSuite({
      projectId,
      name: "Checkout",
      kind: "test_suite",
    });

    const migrated = await withMigrationApplied((tx) =>
      tx.simulationSuite.findFirst({ where: { id: testSuite.id, projectId } }),
    );

    expect(migrated?.name).toBe("Checkout");
    expect(migrated?.kind).toBe("test_suite");
    expect(migrated?.slug).toBe(testSuite.slug);
  });
});

describe("given a run plan carrying the same settings", () => {
  // A custom row IS a run plan, and its stored configuration is what a run of
  // it executes, so the migration must not touch it.
  it("leaves its stored configuration alone", async () => {
    const projectId = projectIds.plans;
    const plan = await createSuite({
      projectId,
      name: "Nightly",
      kind: "run_plan",
    });

    const migrated = await withMigrationApplied((tx) =>
      tx.simulationSuite.findFirst({ where: { id: plan.id, projectId } }),
    );

    expect(migrated?.targets).toEqual([
      { type: "http", referenceId: "agent_prod" },
    ]);
    expect(migrated?.repeatCount).toBe(3);
    expect(migrated?.simulatorModel).toBe("openai/gpt-5-mini");
    expect(migrated?.judgeModel).toBe("openai/gpt-5-mini");
  });
});
