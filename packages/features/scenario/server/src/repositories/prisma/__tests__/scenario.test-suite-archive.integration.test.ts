/**
 * @vitest-environment node
 * Archiving a test suite over real rows: its scenarios and its run-plan row go
 * together. @see specs/suites/test-suites.feature
 */
import { randomUUID } from "node:crypto";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaScenarioRepository } from "../scenario.repository";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for test-suite archive integration tests");
  }
  return connection.client;
}

const namespace = `test-suite-archive-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let repository: PrismaScenarioRepository;

async function createTestSuite(name: string) {
  return database().simulationSuite.create({
    data: {
      projectId,
      name,
      slug: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}`,
      kind: "test_suite",
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
    },
  });
}

async function createScenario(name: string, testSuiteId: string) {
  return database().scenario.create({
    data: {
      projectId,
      name,
      situation: "A customer asks for a refund",
      criteria: ["The agent refunds"],
      labels: [],
      testSuiteId,
    },
  });
}

describe.skipIf(!databaseUrl)("archiving a test suite", () => {
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
    const project = await db.project.create({
      data: {
        name: namespace,
        slug: namespace,
        apiKey: namespace,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;
  });

  beforeEach(async () => {
    await database().scenario.deleteMany({ where: { projectId } });
    await database().simulationSuite.deleteMany({ where: { projectId } });
    repository = PrismaScenarioRepository.create(database());
  });

  afterAll(async () => {
    if (!projectId) return;
    await database().scenario.deleteMany({ where: { projectId } });
    await database().simulationSuite.deleteMany({ where: { projectId } });
    await database().project.delete({ where: { id: projectId } });
    await database().team.delete({ where: { id: teamId } });
    await database().organization.delete({ where: { id: organizationId } });
  });

  describe("given a test suite that has run before", () => {
    /** @scenario "Archiving a test suite archives its run plan too" */
    it("takes the suite's run plan out of the Test Runs list", async () => {
      const suite = await createTestSuite("Refunds");
      const archivedAt = new Date();

      const before = await repository.findPlans({ projectId });
      expect(before.map((plan) => plan.id)).toContain(suite.id);

      await repository.archiveTestSuite({ testSuiteId: suite.id, projectId, archivedAt });

      const after = await repository.findPlans({ projectId });
      expect(after.map((plan) => plan.id)).not.toContain(suite.id);
    });

    /** @scenario "Archiving a test suite archives its run plan too" */
    it("leaves the runs it produced readable under the suite's name", async () => {
      const suite = await createTestSuite("Refunds");

      await repository.archiveTestSuite({
        testSuiteId: suite.id,
        projectId,
        archivedAt: new Date(),
      });

      // The results view resolves an archived plan's name from the same row,
      // which is what keeps a finished run readable after the plan is gone.
      const listed = await repository.findTestSuites({ projectId, includeArchived: true });
      const archived = listed.find((testSuite) => testSuite.id === suite.id);
      expect(archived?.name).toBe("Refunds");
      expect(archived?.archivedAt).not.toBeNull();
    });

    /** @scenario "Archiving a test suite archives the scenarios in it" */
    it("archives the scenarios filed in it in the same write", async () => {
      const suite = await createTestSuite("Refunds");
      const first = await createScenario("One", suite.id);
      const second = await createScenario("Two", suite.id);

      await repository.archiveTestSuite({
        testSuiteId: suite.id,
        projectId,
        archivedAt: new Date(),
      });

      const active = await repository.findAll({ projectId });
      expect(active.map((scenario) => scenario.id)).not.toContain(first.id);
      expect(active.map((scenario) => scenario.id)).not.toContain(second.id);
    });

    /** @scenario "Archiving a test suite that is already archived changes nothing" */
    it("keeps the first archive time on a second archive", async () => {
      const suite = await createTestSuite("Refunds");
      const first = await repository.archiveTestSuite({
        testSuiteId: suite.id,
        projectId,
        archivedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const second = await repository.archiveTestSuite({
        testSuiteId: suite.id,
        projectId,
        archivedAt: new Date("2026-02-02T00:00:00.000Z"),
      });

      expect(second.archivedAt).toEqual(first.archivedAt);
    });
  });
});
