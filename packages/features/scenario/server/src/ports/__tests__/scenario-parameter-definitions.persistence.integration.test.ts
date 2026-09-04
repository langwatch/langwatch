import { type Scenario, type ScenarioService, SimulationService } from "@langwatch/scenario-contract";
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
    throw new Error("DATABASE_URL is required for Scenario parameter persistence tests");
  }

  return connection.client;
}

const namespace = `scenario-parameters-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let scenarios: ScenarioService;

describe.skipIf(!databaseUrl)("Scenario parameter definition persistence", () => {
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

    scenarios = PrismaScenarioAdapter.create({
      prisma: db,
      simulations: Object.create(SimulationService.prototype) as SimulationService,
      ids: new ScenarioIds(),
      testSuiteIds: new TestSuiteIds(),
      clock: new TestClock(),
      secretCipher: new TestSecretCipher(),
    });
  });

  beforeEach(async () => {
    await database().scenarioVersion.deleteMany({ where: { projectId } });
    await database().scenario.deleteMany({ where: { projectId } });
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await cleanupTestRows(database(), [
          ["scenarioVersion", { projectId }],
          ["scenario", { projectId }],
          ["project", { id: projectId }],
          ["team", { id: teamId }],
          ["organization", { id: organizationId }],
        ]);
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  /** @scenario "Parameter definitions are persisted on a scenario" */
  it("reads the declarations back with their descriptions and defaults", async () => {
    const created: Scenario = await scenarios.create({
      projectId,
      name: "Refund Test",
      situation: "A {{ params.account_tier }} customer requests a refund",
      criteria: ["Acknowledges issue"],
      labels: ["support"],
      parameters: [
        {
          name: "account_tier",
          description: "Which plan the customer is on",
          defaultValue: "gold",
        },
        { name: "region" },
      ],
    });

    const readBack = await scenarios.getById({ id: created.id, projectId });

    expect(readBack.parameters).toEqual([
      {
        name: "account_tier",
        description: "Which plan the customer is on",
        defaultValue: "gold",
      },
      { name: "region" },
    ]);
  });

  /** @scenario "Parameter definitions are persisted on a scenario" */
  it("reads a secret declaration back as secret", async () => {
    const created: Scenario = await scenarios.create({
      projectId,
      name: "Secret Test",
      situation: "The agent calls the billing API",
      criteria: ["Calls the API"],
      labels: [],
      parameters: [{ name: "api_token", description: "The billing token", secret: true }],
    });

    const readBack = await scenarios.getById({ id: created.id, projectId });

    expect(readBack.parameters).toEqual([
      { name: "api_token", description: "The billing token", secret: true },
    ]);
  });
});
