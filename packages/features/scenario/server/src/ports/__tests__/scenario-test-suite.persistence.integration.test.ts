import type { ScenarioService as ScenarioServiceContract } from "@langwatch/scenario-contract";
import { SimulationService } from "@langwatch/scenario-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaScenarioAdapter } from "../../index";
import { ScenarioClockPort } from "../scenario-clock.port";
import { ScenarioTestSuiteIdPort, ScenarioIdPort } from "../scenario-id.port";
import { ScenarioSecretCipherPort } from "../scenario-secret-cipher.port";

class AllowTestQueries extends PrismaQueryGuard {
  execute(_context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(_context.args);
  }
}

class ScenarioIds extends ScenarioIdPort {
  next(): string {
    return `scenario_${randomUUID()}`;
  }
}

class TestSuiteIds extends ScenarioTestSuiteIdPort {
  next(): string {
    return `test_suite_${randomUUID()}`;
  }
}

class TestClock extends ScenarioClockPort {
  constructor(private readonly value?: Date) {
    super();
  }

  now(): Date {
    return this.value ?? new Date();
  }
}

class TestSecretCipher extends ScenarioSecretCipherPort {
  encrypt(plaintext: string): string {
    return plaintext;
  }

  decrypt(ciphertext: string): string {
    return ciphertext;
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
    throw new Error("DATABASE_URL is required for Scenario test suite persistence tests");
  }

  return connection.client;
}

const namespace = `scenario-testSuite-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let otherProjectId = "";

function service(clock = new TestClock()): ScenarioServiceContract {
  const simulations = Object.create(SimulationService.prototype) as SimulationService;

  return PrismaScenarioAdapter.create({
    prisma: database(),
    simulations,
    ids: new ScenarioIds(),
    testSuiteIds: new TestSuiteIds(),
    clock,
    secretCipher: new TestSecretCipher(),
  });
}

async function createScenario(input: { name: string; testSuiteId?: string | null }) {
  return service().create({
    projectId,
    name: input.name,
    situation: "A customer asks for help",
    criteria: ["The agent helps"],
    labels: [],
    ...(input.testSuiteId === undefined ? {} : { testSuiteId: input.testSuiteId }),
  });
}

async function testSuiteScenarioIds(testSuiteId: string): Promise<string[]> {
  const testSuite = await database().simulationSuite.findFirst({
    where: { id: testSuiteId, projectId },
    select: { scenarioIds: true },
  });

  return testSuite?.scenarioIds ?? [];
}

async function invariantBreaks(): Promise<string[]> {
  const [testSuites, activeScenarios] = await Promise.all([
    database().simulationSuite.findMany({
      where: { projectId, kind: "test_suite", archivedAt: null },
      select: { id: true, scenarioIds: true },
    }),
    database().scenario.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, testSuiteId: true },
    }),
  ]);

  return testSuites.flatMap((testSuite) => {
    const expected = activeScenarios
      .filter((scenario) => scenario.testSuiteId === testSuite.id)
      .map((scenario) => scenario.id)
      .sort();
    const actual = [...testSuite.scenarioIds].sort();

    return actual.join(",") === expected.join(",")
      ? []
      : [
          `testSuite ${testSuite.id} holds [${actual.join(", ")}] instead of [${expected.join(", ")}]`,
        ];
  });
}

describe.skipIf(!databaseUrl)("Scenario test suite persistence", () => {
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
    const [project, otherProject] = await Promise.all(
      ["main", "other"].map((suffix) =>
        db.project.create({
          data: {
            name: `${namespace}-${suffix}`,
            slug: `${namespace}-${suffix}`,
            apiKey: `${namespace}-${suffix}`,
            teamId,
            language: "typescript",
            framework: "other",
          },
        }),
      ),
    );
    projectId = project.id;
    otherProjectId = otherProject.id;
  });

  beforeEach(async () => {
    const db = database();
    const projectIds = [projectId, otherProjectId];
    await db.scenario.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.simulationSuite.deleteMany({ where: { projectId: { in: projectIds } } });
  });

  afterAll(async () => {
    try {
      if (projectId && otherProjectId) {
        const projectIds = [projectId, otherProjectId];
        await cleanupTestRows(database(), [
          ["scenario", { projectId: { in: projectIds } }],
          ["simulationSuite", { projectId: { in: projectIds } }],
          ["project", { id: { in: projectIds } }],
          ["team", { id: teamId }],
          ["organization", { id: organizationId }],
        ]);
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  it("returns the complete test suite row and lists only active test suites of the project", async () => {
    const testSuites = service();
    const created = await testSuites.createTestSuite({ projectId, name: "Refunds" });
    await testSuites.createTestSuite({ projectId: otherProjectId, name: "Other project" });

    expect(created).toMatchObject({
      id: expect.any(String),
      projectId,
      name: "Refunds",
      slug: "refunds",
      description: null,
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
      simulatorModel: null,
      judgeModel: null,
      kind: "test_suite",
      scope: null,
      archivedAt: null,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    await expect(
      testSuites.tryGetTestSuite({ projectId, testSuiteId: created.id }),
    ).resolves.toEqual(created);
    await expect(testSuites.listTestSuites({ projectId })).resolves.toEqual([created]);
  });

  it("creates filed and unfiled cases while reconciling test suite membership", async () => {
    const testSuites = service();
    const refunds = await testSuites.createTestSuite({ projectId, name: "Refunds" });
    const first = await createScenario({ name: "First", testSuiteId: refunds.id });
    const unfiled = await createScenario({ name: "Unfiled" });

    expect(first.testSuiteId).toBe(refunds.id);
    expect(unfiled.testSuiteId).toBeNull();
    expect(await testSuiteScenarioIds(refunds.id)).toEqual([first.id]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("moves a case between test suites and then unfiles it", async () => {
    const testSuites = service();
    const refunds = await testSuites.createTestSuite({ projectId, name: "Refunds" });
    const checkout = await testSuites.createTestSuite({ projectId, name: "Checkout" });
    const scenario = await createScenario({ name: "Refund", testSuiteId: refunds.id });

    await expect(
      testSuites.update({ id: scenario.id, projectId, testSuiteId: checkout.id }),
    ).resolves.toMatchObject({ testSuiteId: checkout.id });
    expect(await testSuiteScenarioIds(refunds.id)).toEqual([]);
    expect(await testSuiteScenarioIds(checkout.id)).toEqual([scenario.id]);

    await expect(
      testSuites.update({ id: scenario.id, projectId, testSuiteId: null }),
    ).resolves.toMatchObject({
      testSuiteId: null,
    });
    expect(await testSuiteScenarioIds(checkout.id)).toEqual([]);
    await expect(testSuites.list({ projectId })).resolves.toMatchObject([
      { id: scenario.id, testSuiteId: null },
    ]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("drops an archived case from its test suite", async () => {
    const testSuites = service();
    const testSuite = await testSuites.createTestSuite({ projectId, name: "Refunds" });
    const first = await createScenario({ name: "First", testSuiteId: testSuite.id });
    const second = await createScenario({ name: "Second", testSuiteId: testSuite.id });

    await expect(testSuites.archive({ id: first.id, projectId })).resolves.toMatchObject({
      archivedAt: expect.any(Date),
    });

    expect(await testSuiteScenarioIds(testSuite.id)).toEqual([second.id]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("preserves input order, duplicates, retry success, and exact failures in a batch archive", async () => {
    const firstArchiveTime = new Date("2026-01-01T00:00:00.000Z");
    const batchArchiveTime = new Date("2026-01-02T00:00:00.000Z");
    const testSuites = service(new TestClock(firstArchiveTime));
    const testSuite = await testSuites.createTestSuite({ projectId, name: "Refunds" });
    const cases = await Promise.all(
      ["One", "Two"].map((name) => createScenario({ name, testSuiteId: testSuite.id })),
    );
    await testSuites.archive({ id: cases[0]!.id, projectId });

    const requestedIds = [
      cases[1]!.id,
      cases[0]!.id,
      cases[1]!.id,
      "scenario_missing",
      cases[0]!.id,
      "scenario_missing",
    ];
    const batch = await service(new TestClock(batchArchiveTime)).batchArchive({
      projectId,
      ids: requestedIds,
    });
    const stored = await database().scenario.findMany({
      where: { id: { in: cases.map((scenario) => scenario.id) }, projectId },
      select: { id: true, archivedAt: true },
    });

    expect(batch.archived).toEqual([cases[1]!.id, cases[0]!.id, cases[1]!.id, cases[0]!.id]);
    expect(batch.failed).toEqual([
      {
        id: "scenario_missing",
        error: "Not found",
      },
      {
        id: "scenario_missing",
        error: "Not found",
      },
    ]);
    expect(stored).toEqual(
      expect.arrayContaining([
        { id: cases[0]!.id, archivedAt: firstArchiveTime },
        { id: cases[1]!.id, archivedAt: batchArchiveTime },
      ]),
    );
    expect(await testSuiteScenarioIds(testSuite.id)).toEqual([]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("rejects archived, non-testSuite, and cross-project destinations without moving the case", async () => {
    const testSuites = service();
    const active = await testSuites.createTestSuite({ projectId, name: "Active" });
    const archived = await testSuites.createTestSuite({ projectId, name: "Archived" });
    const foreign = await testSuites.createTestSuite({
      projectId: otherProjectId,
      name: "Foreign",
    });
    const plan = await database().simulationSuite.create({
      data: {
        projectId,
        name: "Nightly",
        slug: "nightly",
        kind: "run_plan",
        scenarioIds: [],
        targets: [],
        repeatCount: 1,
        labels: [],
      },
    });
    const scenario = await createScenario({ name: "Refund", testSuiteId: active.id });
    await testSuites.archiveTestSuite({ projectId, testSuiteId: archived.id });

    for (const testSuiteId of [archived.id, plan.id, foreign.id]) {
      await expect(
        testSuites.update({ id: scenario.id, projectId, testSuiteId }),
      ).rejects.toMatchObject({
        code: "scenario_test_suite_not_found",
      });
      await expect(testSuites.getById({ id: scenario.id, projectId })).resolves.toMatchObject({
        testSuiteId: active.id,
      });
    }

    expect(await testSuiteScenarioIds(active.id)).toEqual([scenario.id]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("archives a test suite and its active cases while preserving the final member snapshot", async () => {
    const testSuites = service();
    const testSuite = await testSuites.createTestSuite({ projectId, name: "Refunds" });
    const scenarios = await Promise.all(
      ["One", "Two", "Three"].map((name) => createScenario({ name, testSuiteId: testSuite.id })),
    );

    const archived = await testSuites.archiveTestSuite({ projectId, testSuiteId: testSuite.id });
    const retried = await testSuites.archiveTestSuite({ projectId, testSuiteId: testSuite.id });
    const archivedScenarios = await database().scenario.findMany({
      where: { id: { in: scenarios.map((scenario) => scenario.id) }, projectId },
      select: { id: true, testSuiteId: true, archivedAt: true },
    });

    expect(archived.archivedAt).toEqual(retried.archivedAt);
    expect(new Set(archived.scenarioIds)).toEqual(
      new Set(scenarios.map((scenario) => scenario.id)),
    );
    expect(archivedScenarios).toEqual(
      expect.arrayContaining(
        scenarios.map((scenario) =>
          expect.objectContaining({
            id: scenario.id,
            testSuiteId: testSuite.id,
            archivedAt: expect.any(Date),
          }),
        ),
      ),
    );
  });

  it("keeps both simultaneous filings in one test suite", async () => {
    const testSuites = service();
    const testSuite = await testSuites.createTestSuite({ projectId, name: "Refunds" });
    const [first, second] = await Promise.all([
      createScenario({ name: "First" }),
      createScenario({ name: "Second" }),
    ]);

    await Promise.all([
      testSuites.update({ id: first.id, projectId, testSuiteId: testSuite.id }),
      testSuites.update({ id: second.id, projectId, testSuiteId: testSuite.id }),
    ]);

    expect(new Set(await testSuiteScenarioIds(testSuite.id))).toEqual(
      new Set([first.id, second.id]),
    );
    expect(await invariantBreaks()).toEqual([]);
  });

  it("serializes test suite archive against creating a filed case", async () => {
    const testSuites = service();
    const testSuite = await testSuites.createTestSuite({ projectId, name: "Refunds" });

    const [creation, archivedTestSuite] = await Promise.all([
      createScenario({ name: "Concurrent create", testSuiteId: testSuite.id }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      testSuites.archiveTestSuite({ projectId, testSuiteId: testSuite.id }),
    ]);

    expect(archivedTestSuite.archivedAt).toEqual(expect.any(Date));
    if ("error" in creation) {
      expect(creation.error).toMatchObject({ code: "scenario_test_suite_not_found" });
    } else {
      const stored = await database().scenario.findFirstOrThrow({
        where: { id: creation.value.id, projectId },
      });
      expect(stored.archivedAt).toEqual(expect.any(Date));
      expect(archivedTestSuite.scenarioIds).toContain(creation.value.id);
    }
  });

  it("serializes test suite archive against moving a case into the test suite", async () => {
    const testSuites = service();
    const source = await testSuites.createTestSuite({ projectId, name: "Source" });
    const destination = await testSuites.createTestSuite({ projectId, name: "Destination" });
    const scenario = await createScenario({ name: "Concurrent move", testSuiteId: source.id });

    const [move, archivedTestSuite] = await Promise.all([
      testSuites.update({ id: scenario.id, projectId, testSuiteId: destination.id }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      testSuites.archiveTestSuite({ projectId, testSuiteId: destination.id }),
    ]);
    const stored = await database().scenario.findFirstOrThrow({
      where: { id: scenario.id, projectId },
    });

    expect(archivedTestSuite.archivedAt).toEqual(expect.any(Date));
    if ("error" in move) {
      expect(move.error).toMatchObject({ code: "scenario_test_suite_not_found" });
      expect(stored).toMatchObject({ testSuiteId: source.id, archivedAt: null });
    } else {
      expect(stored).toMatchObject({
        testSuiteId: destination.id,
        archivedAt: expect.any(Date),
      });
      expect(archivedTestSuite.scenarioIds).toContain(scenario.id);
    }
    expect(await invariantBreaks()).toEqual([]);
  });

  it("preserves one timestamp across concurrent test suite archive delivery", async () => {
    const firstTime = new Date("2026-02-01T00:00:00.000Z");
    const secondTime = new Date("2026-02-02T00:00:00.000Z");
    const testSuites = service();
    const testSuite = await testSuites.createTestSuite({ projectId, name: "Refunds" });
    const scenario = await createScenario({ name: "Refund", testSuiteId: testSuite.id });

    const [first, second] = await Promise.all([
      service(new TestClock(firstTime)).archiveTestSuite({ projectId, testSuiteId: testSuite.id }),
      service(new TestClock(secondTime)).archiveTestSuite({ projectId, testSuiteId: testSuite.id }),
    ]);
    const storedTestSuite = await database().simulationSuite.findFirstOrThrow({
      where: { id: testSuite.id, projectId },
    });
    const storedScenario = await database().scenario.findFirstOrThrow({
      where: { id: scenario.id, projectId },
    });

    expect(first.archivedAt).toEqual(second.archivedAt);
    expect(storedTestSuite.archivedAt).toEqual(first.archivedAt);
    expect(storedScenario.archivedAt).toEqual(first.archivedAt);
    expect([firstTime, secondTime]).toContainEqual(first.archivedAt);
  });
});
