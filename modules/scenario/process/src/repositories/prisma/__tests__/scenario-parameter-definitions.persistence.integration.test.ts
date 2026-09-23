import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SimulationService } from "@langwatch/scenario-contract";
import { type Scenario } from "@langwatch/scenario-contract";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nowInstant, type Instant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  ScenarioClock,
  ScenarioTestSuiteId,
  ScenarioId,
  ScenarioSecretCipher,
} from "../../../app/scenario.app.ts";
import { ScenarioService } from "../../../services/scenario.service.ts";
import { PrismaScenarioRepository } from "../scenario.repository.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

class ScenarioIds implements ScenarioId {
  next(): string {
    return `scenario_${randomUUID()}`;
  }
}

class TestSuiteIds implements ScenarioTestSuiteId {
  next(): string {
    return `test_suite_${randomUUID()}`;
  }
}

class TestClock implements ScenarioClock {
  now(): Instant {
    return nowInstant();
  }
}

class TestSecretCipher implements ScenarioSecretCipher {
  encrypt(plaintext: string): string {
    return plaintext;
  }

  decrypt(ciphertext: string): string {
    return ciphertext;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("scenario-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
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

    const mockSimulations = {
      getScenarioSetsData: async () => [],
      findScenarioRunData: async () => null,
      getBatchHistoryForScenarioSet: async () => ({
        batches: [],
        hasMore: false,
        lastUpdatedAt: 0,
        totalCount: 0,
      }),
      findBatchSummary: async () => null,
      getRunDataForBatchRun: async () => ({ changed: false, lastUpdatedAt: 0 }),
      getRunDataForScenarioSet: async () => ({ runs: [], hasMore: false }),
      getAllRunDataForScenarioSet: async () => [],
      getBatchRunCountForScenarioSet: async () => 0,
      getExternalSetSummaries: async () => [],
      getInternalSuiteSummaries: async () => [],
      getLastResultSummaries: async () => [],
      getRunDataForAllSuites: async () => ({ changed: false, lastUpdatedAt: 0 }),
      getLastUpdatedAt: async () => 0,
      getRunIdsForSet: async () => ({ runIds: [], reachedCap: false }),
      getDistinctExternalSetIds: async () => new Set(),
      countRunsForExport: async () => 0,
      countUsage: async () => 0,
      findRunsForExport: async () => ({ runs: [], hasMore: false }),
      queueRun: async () => {},
      startRun: async () => {},
      messageSnapshot: async () => {},
      textMessageStart: async () => {},
      textMessageEnd: async () => {},
      finishRun: async () => {},
      recordEvaluations: async () => {},
      cancelRun: async () => {},
      deleteRun: async () => {},
      recordAgentInstance: async () => {},
    } satisfies SimulationService;

    scenarios = ScenarioService.create({
      repository: PrismaScenarioRepository.create(db),
      simulations: mockSimulations,
      ids: new ScenarioIds(),
      testSuiteIds: new TestSuiteIds(),
      clock: new TestClock(),
      secretCipher: new TestSecretCipher(),
    });
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
    ]);
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await cleanupTestRows(database(), [
          ["scenarioVersion", { projectId }],
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
