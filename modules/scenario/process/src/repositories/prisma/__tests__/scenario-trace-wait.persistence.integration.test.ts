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
/** @see specs/scenarios/judge-trace-wait-settings.feature */
import type { Scenario, SimulationService } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("scenario-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (!connection) {
    throw new Error("DATABASE_URL is required for trace wait persistence tests");
  }

  return connection.client;
}

const namespace = `scenario-trace-wait-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let scenarios: ScenarioService;

function createScenario(name = "Refund flow"): Promise<Scenario> {
  return scenarios.create({
    projectId,
    name,
    situation: "User asks for a refund",
    criteria: ["Agent is polite"],
    labels: [],
    actor: { userId: null, label: "api" },
  });
}

describe.skipIf(!databaseUrl)("Scenario judge trace wait persistence", () => {
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

    scenarios = ScenarioService.create({
      repository: PrismaScenarioRepository.create(db, new TestSecretCipher()),
      simulations: createApiFixture<SimulationService>(),
      ids: new ScenarioIds(),
      testSuiteIds: new TestSuiteIds(),
      clock: new TestClock(),
    });
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
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

  describe("given a scenario saved with a quiet period and a trace wait", () => {
    /** @scenario "Trace wait settings are persisted on the scenario and the run plan" */
    it("reads both back as saved, and a cleared setting as unset", async () => {
      const created = await createScenario();
      expect(created.traceQuietPeriodMs ?? null).toBeNull();

      await scenarios.update({
        id: created.id,
        projectId,
        traceQuietPeriodMs: 12_000,
        traceWaitTimeoutMs: 90_000,
        actor: { userId: null, label: "api" },
      });
      const saved = await scenarios.getById({ id: created.id, projectId });
      expect(saved).toMatchObject({ traceQuietPeriodMs: 12_000, traceWaitTimeoutMs: 90_000 });

      await scenarios.update({
        id: created.id,
        projectId,
        traceQuietPeriodMs: null,
        actor: { userId: null, label: "api" },
      });
      const cleared = await scenarios.getById({ id: created.id, projectId });
      expect(cleared).toMatchObject({ traceQuietPeriodMs: null, traceWaitTimeoutMs: 90_000 });
    });
  });
});
