/**
 * @vitest-environment node
 *
 * The Default suite migration, run against real data.
 *
 * The migration is the half of the "every scenario belongs to a suite"
 * invariant that fixes what is already stored; `default-suite.ts` is the half
 * that keeps new writes correct. This file runs the migration's own SQL, read
 * from the migration directory, so the rule under test is the one that shipped
 * and not a copy of it.
 *
 * The SQL touches every project of the database, so each test runs inside an
 * interactive transaction that is rolled back. The projects and scenarios are
 * seeded before it and cleaned up after; only the migration's writes are
 * discarded.
 *
 * @see specs/suites/default-suite.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { migrationStatements } from "./replay-migration";

const statements = migrationStatements({ nameSuffix: "_default_suite" });
const suffix = nanoid(8);
/** One project per test, so a test never reads another's rows. */
const projectIds = {
  mixed: `test-default-migration-mixed-${suffix}`,
  archivedOnly: `test-default-migration-archived-${suffix}`,
  empty: `test-default-migration-empty-${suffix}`,
  three: `test-default-migration-three-${suffix}`,
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

async function createScenario(params: {
  projectId: string;
  name: string;
  testSuiteId?: string;
  archived?: boolean;
  createdAt?: Date;
}) {
  return prisma.scenario.create({
    data: {
      id: `scenario_${nanoid()}`,
      projectId: params.projectId,
      name: params.name,
      situation: "A customer asks for help",
      criteria: ["The agent helps"],
      labels: [],
      testSuiteId: params.testSuiteId ?? null,
      archivedAt: params.archived ? new Date() : null,
      ...(params.createdAt && { createdAt: params.createdAt }),
    },
  });
}

async function createTestSuite(params: { projectId: string; name: string }) {
  return prisma.simulationSuite.create({
    data: {
      id: `suite_${nanoid()}`,
      projectId: params.projectId,
      name: params.name,
      slug: params.name.toLowerCase(),
      kind: "test_suite",
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
    await prisma.scenario.deleteMany({ where: { projectId } });
    await prisma.simulationSuite.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
  }
});

describe("given a project holding unfiled and filed scenarios", () => {
  /** @scenario "The migration files every unfiled active scenario into a new Default suite" */
  it("files the unfiled ones into a new Default suite and leaves the filed one alone", async () => {
    const projectId = projectIds.mixed;
    const refunds = await createTestSuite({ projectId, name: "Refunds" });
    const loose = [
      await createScenario({ projectId, name: "Loose one" }),
      await createScenario({ projectId, name: "Loose two" }),
    ];
    const filed = await createScenario({
      projectId,
      name: "Filed",
      testSuiteId: refunds.id,
    });

    const result = await withMigrationApplied(async (tx) => {
      const defaultSuite = await tx.simulationSuite.findFirst({
        where: { projectId, name: "Default", kind: "test_suite" },
      });
      const scenarios = await tx.scenario.findMany({
        where: { projectId },
        select: { id: true, testSuiteId: true },
      });
      return { defaultSuite, scenarios };
    });

    expect(result.defaultSuite).not.toBeNull();
    expect(result.defaultSuite?.kind).toBe("test_suite");

    const testSuiteOf = new Map(
      result.scenarios.map((row) => [row.id, row.testSuiteId]),
    );
    for (const scenario of loose) {
      expect(testSuiteOf.get(scenario.id)).toBe(result.defaultSuite?.id);
    }
    expect(testSuiteOf.get(filed.id)).toBe(refunds.id);
  });
});

describe("given a project whose only unfiled scenario is archived", () => {
  /** @scenario "The migration leaves archived scenarios unfiled" */
  it("creates no Default suite and leaves the archived scenario unfiled", async () => {
    const projectId = projectIds.archivedOnly;
    const archived = await createScenario({
      projectId,
      name: "Retired",
      archived: true,
    });

    const result = await withMigrationApplied(async (tx) => ({
      defaultSuite: await tx.simulationSuite.findFirst({
        where: { projectId, name: "Default" },
      }),
      scenario: await tx.scenario.findFirst({
        where: { id: archived.id, projectId },
        select: { testSuiteId: true },
      }),
    }));

    expect(result.defaultSuite).toBeNull();
    expect(result.scenario?.testSuiteId).toBeNull();
  });
});

describe("given a project that holds no scenario", () => {
  // Default is a migration artifact, not an onboarding one: a brand new
  // project starts with no suite and names its own first one.
  /** @scenario "A project with no scenarios gets no Default suite" */
  it("gets no suite at all", async () => {
    const projectId = projectIds.empty;

    const suites = await withMigrationApplied((tx) =>
      tx.simulationSuite.findMany({ where: { projectId } }),
    );

    expect(suites).toEqual([]);
  });
});

describe("given a project holding three unfiled active scenarios", () => {
  /** @scenario "The new Default suite reports the scenarios filed into it" */
  it("lists all three as the Default suite's members, oldest first", async () => {
    const projectId = projectIds.three;
    const base = new Date("2026-01-01T00:00:00.000Z");
    const created = [];
    for (const [index, name] of ["First", "Second", "Third"].entries()) {
      created.push(
        await createScenario({
          projectId,
          name,
          createdAt: new Date(base.getTime() + index * 60_000),
        }),
      );
    }

    const defaultSuite = await withMigrationApplied((tx) =>
      tx.simulationSuite.findFirst({
        where: { projectId, name: "Default", kind: "test_suite" },
      }),
    );

    expect(defaultSuite?.scenarioIds).toEqual(created.map((row) => row.id));
  });
});
