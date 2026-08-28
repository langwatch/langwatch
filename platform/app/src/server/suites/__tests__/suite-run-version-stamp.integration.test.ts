/**
 * @vitest-environment node
 *
 * The scenario version stamp on queued suite runs, against a real database:
 * the version each run records is the one read at queue time, so a later
 * edit of the case never changes what an old run says.
 *
 * @see specs/scenarios/scenario-version-on-runs.feature
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

const projectId = `test-version-stamp-${nanoid(8)}`;
const organizationId = "test-version-stamp-org";

let startSuiteRun: Mock<(data: StartSuiteRunCommandData) => Promise<void>>;
let queueSimulationRun: Mock<(data: QueueRunCommandData) => Promise<void>>;
let suiteService: SuiteService;
const scenarioService = ScenarioService.create(prisma);

async function createCaseAtVersion(name: string, version: number) {
  const scenario = await scenarioService.create({
    projectId,
    name,
    situation: `${name} situation v1`,
    criteria: ["The agent helps"],
    labels: [],
  });
  for (let next = 2; next <= version; next++) {
    await scenarioService.update({
      id: scenario.id,
      projectId,
      data: {
        situation: `${name} situation v${next}`,
      },
    });
  }
  return scenario;
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

function stampOf(command: QueueRunCommandData) {
  return (command.metadata as { langwatch?: Record<string, unknown> })
    .langwatch;
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

describe("the version stamp on suite runs", () => {
  /** @scenario "A test suite run records the version of every scenario it ran" */
  it("records each case's own stored version on its queued run", async () => {
    const atThree = await createCaseAtVersion("Refund", 3);
    const atSeven = await createCaseAtVersion("Checkout", 7);
    const agent = await createHttpAgent();
    const suite = await suiteService.create({
      projectId,
      name: "Nightly",
      scenarioIds: [atThree.id, atSeven.id],
      targets: [{ type: "http", referenceId: agent.id }],
      repeatCount: 1,
      labels: [],
    });

    await suiteService.run({
      suite,
      projectId,
      organizationId,
      idempotencyKey: `run-${nanoid(6)}`,
    });

    const stampsByScenarioId = new Map(
      queueSimulationRun.mock.calls.map((call) => [
        call[0].scenarioId,
        stampOf(call[0]),
      ]),
    );
    expect(stampsByScenarioId.get(atThree.id)).toEqual({
      targetReferenceId: agent.id,
      targetType: "http",
      scenarioVersion: 3,
    });
    expect(stampsByScenarioId.get(atSeven.id)).toEqual({
      targetReferenceId: agent.id,
      targetType: "http",
      scenarioVersion: 7,
    });
  });

  /** @scenario "Editing a scenario after a run leaves the run unchanged" */
  it("keeps the queued stamp at the version read at queue time after a later edit", async () => {
    const scenario = await createCaseAtVersion("Refund", 5);
    const agent = await createHttpAgent();
    const suite = await suiteService.create({
      projectId,
      name: "Nightly",
      scenarioIds: [scenario.id],
      targets: [{ type: "http", referenceId: agent.id }],
      repeatCount: 1,
      labels: [],
    });

    await suiteService.run({
      suite,
      projectId,
      organizationId,
      idempotencyKey: `run-${nanoid(6)}`,
    });

    await scenarioService.update({
      id: scenario.id,
      projectId,
      data: {
        situation: "Edited after the run",
      },
    });
    const stored = await scenarioService.getById({
      id: scenario.id,
      projectId,
    });
    expect(stored?.version).toBe(6);

    // The queued command still carries the version read when it was queued.
    expect(stampOf(queueSimulationRun.mock.calls[0]![0])).toMatchObject({
      scenarioVersion: 5,
    });
  });
});
