/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-version-on-runs.feature
 * A queued run records the version read at queue time; a later edit never moves it.
 */
import { randomUUID } from "node:crypto";
import type { AgentApi } from "@langwatch/agent-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { SimulationService, type Scenario, type ScenarioApi } from "@langwatch/scenario-contract";
import type { SuiteApi, StartSuiteRunCommandData } from "@langwatch/suite-contract";
import {
  PostgresSuiteRepositories,
  SuiteApp,
  SuiteExecutionService,
  SuiteRunCommandsPort,
  SuiteRunIdPort,
  type QueueSimulationRunCommandData,
} from "@langwatch/suite-server";
import { cleanupTestRows } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ScenarioService } from "../services/scenario.service.ts";
import { PrismaScenarioRepository } from "../repositories/prisma/scenario.repository.ts";
import { ScenarioClockPort } from "../ports/scenario-clock.port.ts";
import { ScenarioIdPort, ScenarioTestSuiteIdPort } from "../ports/scenario-id.port.ts";
import { ScenarioSecretCipherPort } from "../ports/scenario-secret-cipher.port.ts";

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

class RunIds extends SuiteRunIdPort {
  next(): string {
    return `scenario_run_${randomUUID()}`;
  }
}

/** Records the durable commands the execution service would have appended. */
class CapturingCommands extends SuiteRunCommandsPort {
  readonly queued: QueueSimulationRunCommandData[] = [];

  async startSuiteRun(_data: StartSuiteRunCommandData): Promise<void> {}

  async queueSimulationRun(data: QueueSimulationRunCommandData): Promise<void> {
    this.queued.push(data);
  }
}

/** Targets are opaque JSON on the suite row, so nothing here needs a real FK. */
type FakeAgent = { id: string; name: string; type: "http" };

function fakeAgentApi(agents: Map<string, FakeAgent>): AgentApi {
  return createApiFixture<AgentApi>({
    getReferenceStates: async ({ ids }: { ids: string[] }) =>
      ids.flatMap((id) => {
        const agent = agents.get(id);
        return agent ? [{ id, archivedAt: null, type: agent.type, name: agent.name }] : [];
      }),
    getNamesByIds: async ({ ids }: { ids: string[] }) =>
      ids.flatMap((id) => {
        const agent = agents.get(id);
        return agent ? [{ id, name: agent.name }] : [];
      }),
    getConnectedByNameAndEnvironment: async () => [],
    ownersOf: async () => new Map(),
  });
}

function fakePromptApi(): PromptApi {
  return createApiFixture<PromptApi>({
    getExistingIds: async () => [],
    getNamesByIds: async () => [],
  });
}

/**
 * The scenario capability the suite application reads through, served by this
 * test's own Prisma-backed scenario service so the versions are the stored ones.
 */
function scenarioApiOver(service: ScenarioService): ScenarioApi {
  return createApiFixture<ScenarioApi>({
    list: (input) => service.list(input),
    listTestSuites: (input) => service.listTestSuites(input),
    findTestSuite: (input) => service.findTestSuite(input),
    createTestSuite: (input) => service.createTestSuite(input),
    updateTestSuite: (input) => service.updateTestSuite(input),
    renameTestSuite: (input) => service.renameTestSuite(input),
    archiveTestSuite: (input) => service.archiveTestSuite(input),
    getTestSuiteRunDefinition: (input) => service.getTestSuiteRunDefinition(input),
    getReferenceStates: (input) => service.getReferenceStates(input),
    getRunConfigs: (input) => service.getRunConfigs(input),
    getModelChoices: (input) => service.getModelChoices(input),
    getNamesByIds: (input) => service.getNamesByIds(input),
    resolveRunParameters: (input) => service.resolveRunParameters(input),
    resolveRunParametersForScenarios: (input) => service.resolveRunParametersForScenarios(input),
  });
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
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
let project: ProjectWithTeam | null = null;
let scenarios: ScenarioService;
let suites: SuiteApi;
let commands: CapturingCommands;
let agents: Map<string, FakeAgent>;

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

function createHttpAgent(): FakeAgent {
  const agent: FakeAgent = {
    id: `agent_${randomUUID()}`,
    name: `Agent ${randomUUID().slice(0, 8)}`,
    type: "http",
  };
  agents.set(agent.id, agent);
  return agent;
}

function stampOf(command: QueueSimulationRunCommandData) {
  return (command.metadata as { langwatch?: Record<string, unknown> }).langwatch;
}

describe.skipIf(!databaseUrl)("the version stamp on suite runs", () => {
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
      include: { team: true },
    });
    projectId = created.id;
    project = created;
  });

  beforeEach(async () => {
    const db = database();
    await cleanupTestRows(db, [
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
    ]);

    agents = new Map();
    commands = new CapturingCommands();
    scenarios = ScenarioService.create({
      repository: PrismaScenarioRepository.create(db),
      simulations: Object.create(SimulationService.prototype) as SimulationService,
      ids: new ScenarioIds(),
      testSuiteIds: new TestSuiteIds(),
      clock: new TestClock(),
      secretCipher: new TestSecretCipher(),
    });
    const scenarioApi = scenarioApiOver(scenarios);
    suites = SuiteApp.create({
      config: undefined,
      resources: { own: () => undefined, ownService: () => undefined },
      dependencies: {
        scenarios: scenarioApi,
        agents: fakeAgentApi(agents),
        prompts: fakePromptApi(),
        projects: createApiFixture<ProjectApi>({
          tryGetWithTeam: async (id: string) => (id === projectId ? project : null),
        }),
      },
      infrastructure: {
        execution: SuiteExecutionService.create({
          commands,
          ids: new RunIds(),
          scenarios: scenarioApi,
        }),
        resolveClickHouseClient: null,
        defaultRetentionDays: 30,
      },
      repositories: PostgresSuiteRepositories.create({ prisma: db }),
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
  it("records each case's own stored version on its queued run", async () => {
    const atThree = await createCaseAtVersion("Refund", 3);
    const atSeven = await createCaseAtVersion("Checkout", 7);
    const agent = createHttpAgent();
    const suite = await suites.create({
      projectId,
      name: "Nightly",
      scenarioIds: [atThree.id, atSeven.id],
      targets: [{ type: "http", referenceId: agent.id }],
      repeatCount: 1,
      labels: [],
    });

    await suites.run({
      id: suite.id,
      projectId,
      idempotencyKey: `run-${randomUUID().slice(0, 8)}`,
    });

    const stampsByScenarioId = new Map(
      commands.queued.map((command) => [command.scenarioId, stampOf(command)]),
    );
    expect(stampsByScenarioId.get(atThree.id)).toMatchObject({
      targetReferenceId: agent.id,
      targetType: "http",
      scenarioVersion: 3,
    });
    expect(stampsByScenarioId.get(atSeven.id)).toMatchObject({
      targetReferenceId: agent.id,
      targetType: "http",
      scenarioVersion: 7,
    });
  });

  /** @scenario "Editing a scenario after a run leaves the run unchanged" */
  it("keeps the queued stamp at the version read at queue time after a later edit", async () => {
    const scenario = await createCaseAtVersion("Refund", 5);
    const agent = createHttpAgent();
    const suite = await suites.create({
      projectId,
      name: "Nightly",
      scenarioIds: [scenario.id],
      targets: [{ type: "http", referenceId: agent.id }],
      repeatCount: 1,
      labels: [],
    });

    await suites.run({
      id: suite.id,
      projectId,
      idempotencyKey: `run-${randomUUID().slice(0, 8)}`,
    });

    await scenarios.update({
      id: scenario.id,
      projectId,
      situation: "Edited after the run",
    });
    const stored = await scenarios.getById({ id: scenario.id, projectId });
    expect(stored?.version).toBe(6);

    // The queued command still carries the version read when it was queued.
    expect(stampOf(commands.queued[0]!)).toMatchObject({ scenarioVersion: 5 });
  });
});
