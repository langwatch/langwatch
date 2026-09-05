/**
 * @see specs/scenarios/scenario-model-selection.feature
 * @see specs/scenarios/simulation-run-model-resolution.feature
 * @see specs/suites/suite-model-selection.feature
 */
import type { Scenario, ScenarioService } from "@langwatch/scenario-contract";
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
    throw new Error("DATABASE_URL is required for model-selection persistence tests");
  }

  return connection.client;
}

const namespace = `scenario-models-${randomUUID()}`;
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

describe.skipIf(!databaseUrl)("Scenario and run-plan model persistence", () => {
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
    await database().simulationSuite.deleteMany({ where: { projectId } });
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

  describe("given a scenario", () => {
    describe("when it is updated with a simulator and judge model", () => {
      /** @scenario "Simulator and judge models are persisted on the scenario" */
      it("stores both model selections", async () => {
        const created = await createScenario();
        expect(created.simulatorModel).toBeNull();
        expect(created.judgeModel).toBeNull();

        const updated = await scenarios.update({
          id: created.id,
          projectId,
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-nano",
          actor: { userId: null, label: "api" },
        });
        expect(updated.simulatorModel).toBe("openai/gpt-5-mini");
        expect(updated.judgeModel).toBe("openai/gpt-5-nano");

        const reread = await database().scenario.findFirst({
          where: { id: created.id, projectId },
        });
        expect(reread?.simulatorModel).toBe("openai/gpt-5-mini");
        expect(reread?.judgeModel).toBe("openai/gpt-5-nano");
      });
    });
  });

  describe("given a latest alias as the model override", () => {
    describe("when a scenario and a run plan are saved with it", () => {
      /** @scenario "A latest alias is stored verbatim on the scenario and the run plan" */
      it("stores the alias string verbatim, not a concrete model", async () => {
        const scenario = await createScenario("Alias scenario");
        await scenarios.update({
          id: scenario.id,
          projectId,
          simulatorModel: "openai/latest",
          actor: { userId: null, label: "api" },
        });

        const suite = await database().simulationSuite.create({
          data: {
            id: `suite_${randomUUID()}`,
            projectId,
            name: "Alias plan",
            slug: `alias-plan-${randomUUID()}`,
            kind: "run_plan",
            scenarioIds: [],
            targets: [],
            repeatCount: 1,
            labels: [],
            judgeModel: "anthropic/latest-mini",
          },
        });

        const scenarioReread = await database().scenario.findFirst({
          where: { id: scenario.id, projectId },
        });
        expect(scenarioReread?.simulatorModel).toBe("openai/latest");

        const suiteReread = await database().simulationSuite.findFirst({
          where: { id: suite.id, projectId },
        });
        expect(suiteReread?.judgeModel).toBe("anthropic/latest-mini");
      });
    });
  });

  describe("given a run plan", () => {
    describe("when it is saved with a simulator and judge model", () => {
      /** @scenario "Simulator and judge models are persisted on the run plan" */
      it("stores both model selections", async () => {
        const created = await database().simulationSuite.create({
          data: {
            id: `suite_${randomUUID()}`,
            projectId,
            name: "Run plan",
            slug: `run-plan-${randomUUID()}`,
            kind: "run_plan",
            scenarioIds: [],
            targets: [],
            repeatCount: 1,
            labels: [],
            simulatorModel: "openai/gpt-5-mini",
            judgeModel: "openai/gpt-5-nano",
          },
        });
        expect(created.simulatorModel).toBe("openai/gpt-5-mini");
        expect(created.judgeModel).toBe("openai/gpt-5-nano");

        const reread = await database().simulationSuite.findFirst({
          where: { id: created.id, projectId },
        });
        expect(reread?.simulatorModel).toBe("openai/gpt-5-mini");
        expect(reread?.judgeModel).toBe("openai/gpt-5-nano");
      });
    });
  });
});
