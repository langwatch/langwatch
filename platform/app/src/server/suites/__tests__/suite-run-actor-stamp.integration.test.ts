/**
 * @vitest-environment node
 *
 * The actor stamp on queued suite runs, against a real database: the person
 * who started the batch reaches every run of it, through the same service
 * call the run dialog makes.
 *
 * @see specs/scenarios/run-actor-on-runs.feature
 */
import { nanoid } from "nanoid";
import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "~/generated/prisma/client";
import { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ScenarioService } from "../../scenarios/scenario.service";
import { SuiteService } from "../suite.service";

const projectId = `test-actor-stamp-${nanoid(8)}`;
const organizationId = "test-actor-stamp-org";

let startSuiteRun: Mock<(data: StartSuiteRunCommandData) => Promise<void>>;
let queueSimulationRun: Mock<(data: QueueRunCommandData) => Promise<void>>;
let suiteService: SuiteService;
const scenarioService = ScenarioService.create(prisma);

function stampOf(command: QueueRunCommandData) {
  return (command.metadata as { langwatch?: Record<string, unknown> })
    .langwatch;
}

async function createHttpAgent(): Promise<Agent> {
  return prisma.agent.create({
    data: {
      projectId,
      name: `Agent ${nanoid(4)}`,
      type: "http",
      config: {
        url: "https://example.com/chat",
        method: "POST",
        headers: [],
        bodyTemplate: '{"message": "{{input}}"}',
      },
    },
  });
}

/** A suite of two scenarios against one agent, ready to run. */
async function createRunnableSuite() {
  const first = await scenarioService.create({
    projectId,
    name: "Refund",
    situation: "The customer asks for a refund",
    criteria: ["The agent helps"],
    labels: [],
  });
  const second = await scenarioService.create({
    projectId,
    name: "Checkout",
    situation: "The customer cannot pay",
    criteria: ["The agent helps"],
    labels: [],
  });
  const agent = await createHttpAgent();
  const suite = await suiteService.create({
    projectId,
    name: "Nightly",
    scenarioIds: [first.id, second.id],
    targets: [{ type: "http", referenceId: agent.id }],
    repeatCount: 1,
    labels: [],
  });
  return { suite, agent };
}

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
});

beforeEach(async () => {
  await prisma.scenarioVersion.deleteMany({ where: { projectId } });
  await prisma.scenario.deleteMany({ where: { projectId } });
  await prisma.simulationSuite.deleteMany({ where: { projectId } });
  await prisma.agent.deleteMany({ where: { projectId } });
  startSuiteRun = vi.fn(async () => {});
  queueSimulationRun = vi.fn(async () => {});
  suiteService = SuiteService.create({
    prisma,
    suiteRunService: SuiteRunService.create({
      resolveClickHouseClient: null,
      startSuiteRun,
      queueSimulationRun,
    }),
  });
});

describe("the actor stamp on suite runs", () => {
  describe("when a signed-in person starts the run", () => {
    /** @scenario "A suite run started in the app records the person who started it" */
    it("records their user id and the surface on every run of the batch", async () => {
      const { suite } = await createRunnableSuite();

      await suiteService.run({
        suite,
        projectId,
        organizationId,
        idempotencyKey: `run-${nanoid(6)}`,
        actor: { id: "user_lena", label: "user" },
      });

      expect(queueSimulationRun.mock.calls).toHaveLength(2);
      for (const [command] of queueSimulationRun.mock.calls) {
        expect(stampOf(command)).toMatchObject({
          actorId: "user_lena",
          actorLabel: "user",
        });
      }
    });
  });

  describe("when the caller names no person", () => {
    it("records no actor on any run of the batch", async () => {
      const { suite } = await createRunnableSuite();

      await suiteService.run({
        suite,
        projectId,
        organizationId,
        idempotencyKey: `run-${nanoid(6)}`,
      });

      expect(queueSimulationRun.mock.calls).toHaveLength(2);
      for (const [command] of queueSimulationRun.mock.calls) {
        expect(stampOf(command)).not.toHaveProperty("actorId");
        expect(stampOf(command)).not.toHaveProperty("actorLabel");
      }
    });
  });
});
