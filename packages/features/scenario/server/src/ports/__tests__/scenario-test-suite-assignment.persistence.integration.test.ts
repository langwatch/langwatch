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
import type { ScenarioService } from "@langwatch/scenario-contract";

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

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (!connection) {
    throw new Error("DATABASE_URL is required for test suite assignment persistence tests");
  }

  return connection.client;
}

const namespace = `scenario-suite-assign-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let otherProjectId = "";
let scenarios: ScenarioService;
let otherScenarios: ScenarioService;

describe.skipIf(!databaseUrl)("Moving a scenario between test suites", () => {
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
    if (!project || !otherProject) {
      throw new Error("Expected both test suite assignment persistence test projects");
    }
    projectId = project.id;
    otherProjectId = otherProject.id;

    const options = {
      prisma: db,
      simulations: Object.create(SimulationService.prototype) as SimulationService,
      ids: new ScenarioIds(),
      testSuiteIds: new TestSuiteIds(),
      clock: new TestClock(),
      secretCipher: new TestSecretCipher(),
    };
    scenarios = PrismaScenarioAdapter.create(options);
    otherScenarios = PrismaScenarioAdapter.create(options);
  });

  beforeEach(async () => {
    const projectIds = [projectId, otherProjectId];
    await database().scenarioVersion.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().scenario.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().simulationSuite.deleteMany({ where: { projectId: { in: projectIds } } });
  });

  afterAll(async () => {
    try {
      if (projectId && otherProjectId) {
        const projectIds = [projectId, otherProjectId];
        await cleanupTestRows(database(), [
          ["scenarioVersion", { projectId: { in: projectIds } }],
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

  /** @scenario "Filing a scenario into a suite of another project is refused with scenario_test_suite_not_found" */
  it("refuses when the named test suite belongs to another project", async () => {
    const otherSuite = await otherScenarios.createTestSuite({
      projectId: otherProjectId,
      name: "Other Project's Suite",
    });
    const scenario = await scenarios.create({
      projectId,
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });

    await expect(
      scenarios.moveToTestSuite({
        projectId,
        scenarioId: scenario.id,
        testSuiteId: otherSuite.id,
      }),
    ).rejects.toMatchObject({ code: "scenario_test_suite_not_found" });
  });

  /** @scenario "Moving a scenario from its row menu regroups the scenario list" */
  it("moves a scenario between two suites of the same project, keeping its id", async () => {
    const refunds = await scenarios.createTestSuite({ projectId, name: "Refunds" });
    const checkout = await scenarios.createTestSuite({ projectId, name: "Checkout" });
    const scenario = await scenarios.create({
      projectId,
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
      testSuiteId: refunds.id,
    });

    const moved = await scenarios.moveToTestSuite({
      projectId,
      scenarioId: scenario.id,
      testSuiteId: checkout.id,
    });

    expect(moved.id).toBe(scenario.id);
    expect(moved.testSuiteId).toBe(checkout.id);
    expect(moved.testSuiteId).not.toBe(refunds.id);
  });
});
