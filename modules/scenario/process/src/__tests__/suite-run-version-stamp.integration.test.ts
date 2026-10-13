/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-version-on-runs.feature
 * The version a suite stamps on each queued run is the one the run-config read answers at
 * queue time (suite's own stamping: suite-execution-run-stamp.unit.test.ts).
 */
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
import type { Scenario, SimulationService } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nowInstant, type Instant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  ScenarioClock,
  ScenarioId,
  ScenarioTestSuiteId,
  ScenarioSecretCipher,
} from "../app/scenario.app.ts";
import { PrismaScenarioRepository } from "../repositories/prisma/scenario.repository.ts";
import { ScenarioService } from "../services/scenario.service.ts";

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
    throw new Error("DATABASE_URL is required for the suite run version stamp test");
  }
  return connection.client;
}

const namespace = `suite-version-stamp-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let scenarios: ScenarioService;

async function createCaseAtVersion(name: string, version: number): Promise<Scenario> {
  const scenario = await scenarios.create({
    projectId,
    name,
    situation: `${name} situation v1`,
    criteria: ["The agent helps"],
    labels: [],
    actor: { userId: null, label: "api" },
  });
  for (let next = 2; next <= version; next++) {
    await scenarios.update({
      id: scenario.id,
      projectId,
      situation: `${name} situation v${next}`,
    });
  }
  return scenario;
}

describe.skipIf(!databaseUrl)("the version a suite run reads for its stamp", () => {
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
    const created = await db.project.create({
      data: {
        name: namespace,
        slug: namespace,
        apiKey: namespace,
        teamId,
        language: "typescript",
        framework: "other",
      },
    });
    projectId = created.id;
  });

  beforeEach(async () => {
    const db = database();
    await cleanupTestRows(db, [
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
    ]);
    scenarios = ScenarioService.create({
      repository: PrismaScenarioRepository.create(db, new TestSecretCipher()),
      simulations: createApiFixture<SimulationService>(),
      ids: new ScenarioIds(),
      testSuiteIds: new TestSuiteIds(),
      clock: new TestClock(),
    });
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

  /** @scenario "A test suite run records the version of every scenario it ran" */
  it("answers each case's own stored version in the run configs a suite queues from", async () => {
    const atThree = await createCaseAtVersion("Refund", 3);
    const atSeven = await createCaseAtVersion("Checkout", 7);

    const configs = await scenarios.getRunConfigs({ ids: [atThree.id, atSeven.id], projectId });

    const versions = new Map(configs.map((config) => [config.id, config.version]));
    expect(versions.get(atThree.id)).toBe(3);
    expect(versions.get(atSeven.id)).toBe(7);
  });

  /** @scenario "Editing a scenario after a run leaves the run unchanged" */
  it("keeps the version read at queue time after a later edit moves the stored one", async () => {
    const scenario = await createCaseAtVersion("Refund", 5);
    const [queuedFrom] = await scenarios.getRunConfigs({ ids: [scenario.id], projectId });

    await scenarios.update({ id: scenario.id, projectId, situation: "Edited after the run" });

    const stored = await scenarios.getById({ id: scenario.id, projectId });
    expect(stored.version).toBe(6);
    expect(queuedFrom?.version).toBe(5);
  });
});
