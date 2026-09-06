/**
 * Auto-filing into the project's Default test suite, against real Postgres.
 * Every scenario belongs to exactly one suite: clearing a scenario's suite
 * files it back into Default rather than leaving it loose.
 */
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
import { ScenarioClockPort } from "../../ports/scenario-clock.port";
import { ScenarioTestSuiteIdPort, ScenarioIdPort } from "../../ports/scenario-id.port";
import { ScenarioSecretCipherPort } from "../../ports/scenario-secret-cipher.port";
import { DEFAULT_SUITE_NAME, DEFAULT_SUITE_SLUG } from "../../rules/default-suite.rules";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
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
  now(): Date {
    return new Date();
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

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("a database URL is required for this suite");
  return connection.client;
}

const namespace = `scenario-default-suite-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";

function service(): ScenarioServiceContract {
  const simulations = Object.create(SimulationService.prototype) as SimulationService;
  return PrismaScenarioAdapter.create({
    prisma: database(),
    simulations,
    ids: new ScenarioIds(),
    testSuiteIds: new TestSuiteIds(),
    clock: new TestClock(),
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

async function defaultSuites() {
  return database().simulationSuite.findMany({
    where: { projectId, kind: "test_suite", archivedAt: null, name: DEFAULT_SUITE_NAME },
    select: { id: true, slug: true, scenarioIds: true },
  });
}

describe.skipIf(!databaseUrl)("the Default test suite on the write path", () => {
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
        language: "typescript",
        framework: "other",
      },
    });
    projectId = project.id;
  });

  beforeEach(async () => {
    const db = database();
    await cleanupTestRows(db, [
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
    ]);
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await cleanupTestRows(database(), [
          ["scenario", { projectId }],
          ["simulationSuite", { projectId }],
          ["project", { id: projectId }],
          ["team", { id: teamId }],
          ["organization", { id: organizationId }],
        ]);
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  /** @scenario "A scenario created with no suite is filed into Default" */
  /** @scenario "A scenario created without naming a test suite is filed into Default" */
  it("creates the Default suite on the first unfiled write and files the scenario into it", async () => {
    const scenario = await createScenario({ name: "First" });

    const suites = await defaultSuites();
    expect(suites).toHaveLength(1);
    expect(suites[0]!.slug).toBe(DEFAULT_SUITE_SLUG);
    expect(scenario.testSuiteId).toBe(suites[0]!.id);
    expect(suites[0]!.scenarioIds).toEqual([scenario.id]);
  });

  /** @scenario "A second scenario created with no suite reuses the same Default" */
  it("reuses the Default suite the project already holds", async () => {
    const first = await createScenario({ name: "First" });
    const second = await createScenario({ name: "Second" });

    const suites = await defaultSuites();
    expect(suites).toHaveLength(1);
    expect(second.testSuiteId).toBe(first.testSuiteId);
    expect([...suites[0]!.scenarioIds].sort()).toEqual([first.id, second.id].sort());
  });

  /** @scenario "A Default suite created while another suite already owns the slug takes a numbered slug" */
  it("takes a numbered slug when another suite of the project owns 'default'", async () => {
    await database().simulationSuite.create({
      data: {
        projectId,
        name: "Nightly",
        slug: DEFAULT_SUITE_SLUG,
        kind: "run_plan",
        scenarioIds: [],
        targets: [],
        repeatCount: 1,
        labels: [],
      },
    });

    const scenario = await createScenario({ name: "First" });

    const suites = await defaultSuites();
    expect(suites).toHaveLength(1);
    expect(suites[0]!.slug).not.toBe(DEFAULT_SUITE_SLUG);
    expect(suites[0]!.slug.startsWith(`${DEFAULT_SUITE_SLUG}-`)).toBe(true);
    expect(scenario.testSuiteId).toBe(suites[0]!.id);
  });

  /** @scenario "Two scenarios created at the same time share one Default suite" */
  it("creates exactly one Default suite when two unfiled creates race", async () => {
    const [first, second] = await Promise.all([
      createScenario({ name: "Racer one" }),
      createScenario({ name: "Racer two" }),
    ]);

    const suites = await defaultSuites();
    expect(suites).toHaveLength(1);
    expect(first.testSuiteId).toBe(suites[0]!.id);
    expect(second.testSuiteId).toBe(suites[0]!.id);
    expect([...suites[0]!.scenarioIds].sort()).toEqual([first!.id, second!.id].sort());
  });

  /** @scenario "Removing a scenario from its suite files it into Default instead of leaving it loose" */
  /** @scenario "Taking a scenario out of its test suite files it into Default" */
  /** @scenario "Taking a scenario out of its suite moves it to Default" */
  it("files a scenario cleared out of its suite into Default and drops it from the old one", async () => {
    const suites = service();
    const refunds = await suites.createTestSuite({ projectId, name: "Refunds" });
    const scenario = await createScenario({ name: "Filed", testSuiteId: refunds.id });

    const moved = await suites.moveToTestSuite({
      projectId,
      scenarioId: scenario.id,
      testSuiteId: null,
    });

    const [defaultSuite] = await defaultSuites();
    expect(defaultSuite).toBeDefined();
    expect(moved.testSuiteId).toBe(defaultSuite!.id);
    expect(defaultSuite!.scenarioIds).toEqual([scenario.id]);
    await expect(
      suites.tryGetTestSuite({ projectId, testSuiteId: refunds.id }),
    ).resolves.toMatchObject({ scenarioIds: [] });
  });
});
