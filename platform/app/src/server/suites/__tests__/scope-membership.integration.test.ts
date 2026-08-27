/**
 * @vitest-environment node
 *
 * What a run plan covers is a rule, resolved against the project when the run
 * starts. These tests run the real resolve against Postgres, because the
 * question they answer is which rows the rule matches.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 */
import { nanoid } from "nanoid";
import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, SimulationSuite } from "~/generated/prisma/client";
import { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ScenarioService } from "../../scenarios/scenario.service";
import type { SuiteScope } from "@langwatch/suite-contract";
import { SuiteService } from "../suite.service";

const projectId = `test-suite-scope-${nanoid(8)}`;
const otherProjectId = `test-suite-scope-other-${nanoid(8)}`;
const organizationId = "test-suite-scope-org";

let queueSimulationRun: Mock<(data: QueueRunCommandData) => Promise<void>>;
let suiteService: SuiteService;
const scenarioService = ScenarioService.create(prisma);

async function createCase({
  name,
  folderId,
  labels = [],
  project = projectId,
}: {
  name: string;
  folderId?: string;
  labels?: string[];
  project?: string;
}) {
  return scenarioService.create({
    projectId: project,
    name,
    situation: "A customer asks for help",
    criteria: ["The agent helps"],
    labels,
    ...(folderId !== undefined && { folderId }),
  });
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

/** A run plan carrying the scope, already pointed at an agent. */
async function createPlan(scope: SuiteScope): Promise<SimulationSuite> {
  const agent = await createHttpAgent();
  return suiteService.create({
    projectId,
    name: `Plan ${nanoid(6)}`,
    scenarioIds: [],
    scope,
    targets: [{ type: "http", referenceId: agent.id }],
    repeatCount: 1,
    labels: [],
  });
}

/** The plan as it is stored right now. */
async function reread(suite: SimulationSuite): Promise<SimulationSuite> {
  return prisma.simulationSuite.findFirstOrThrow({
    where: { id: suite.id, projectId },
  });
}

async function runPlan(suite: SimulationSuite) {
  return suiteService.run({
    suite,
    projectId,
    organizationId,
    idempotencyKey: `run-${nanoid(6)}`,
  });
}

/** The scenarios the run actually queued. */
function scheduledScenarioIds(): Set<string> {
  return new Set(queueSimulationRun.mock.calls.map((call) => call[0].scenarioId));
}

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  for (const id of [projectId, otherProjectId]) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name: id,
        slug: id,
        apiKey: `sk-lw-${id}`,
        teamId: team!.id,
        language: "en",
        framework: "test",
      },
    });
  }
});

beforeEach(async () => {
  for (const id of [projectId, otherProjectId]) {
    await prisma.scenario.deleteMany({ where: { projectId: id } });
    await prisma.simulationSuite.deleteMany({ where: { projectId: id } });
    await prisma.agent.deleteMany({ where: { projectId: id } });
  }
  queueSimulationRun = vi.fn(async () => {});
  suiteService = SuiteService.create({
    prisma,
    suiteRunService: SuiteRunService.create({
      resolveClickHouseClient: null,
      startSuiteRun: vi.fn(async () => {}),
      queueSimulationRun,
    }),
  });
});

describe("what a run plan covers", () => {
  describe("when the plan covers all test cases", () => {
    /** @scenario "A plan scoped to all test cases runs every active case" */
    it("runs every active case of the project", async () => {
      const cases = [
        await createCase({ name: "One" }),
        await createCase({ name: "Two" }),
        await createCase({ name: "Three" }),
      ];
      const plan = await createPlan({ mode: "all" });

      const result = await runPlan(plan);

      expect(result.jobCount).toBe(3);
      expect(scheduledScenarioIds()).toEqual(new Set(cases.map((entry) => entry.id)));
    });

    /** @scenario "Archived test cases are left out of a dynamic scope" */
    it("leaves an archived case out", async () => {
      const kept = await createCase({ name: "Kept" });
      const gone = await createCase({ name: "Gone" });
      await scenarioService.archive({ id: gone.id, projectId });
      const plan = await createPlan({ mode: "all" });

      await runPlan(plan);

      expect(scheduledScenarioIds()).toEqual(new Set([kept.id]));
    });
  });

  describe("when the plan covers chosen test suites", () => {
    /** @scenario "A plan scoped to test suites runs the cases filed in them" */
    it("runs the cases filed in them and nothing else", async () => {
      const first = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      const second = await suiteService.createFolder({
        projectId,
        name: "Checkout",
      });
      const inFirst = await createCase({ name: "One", folderId: first.id });
      await createCase({ name: "Two", folderId: second.id });
      const plan = await createPlan({
        mode: "folders",
        folderIds: [first.id],
      });

      await runPlan(plan);

      expect(scheduledScenarioIds()).toEqual(new Set([inFirst.id]));
    });

    /** @scenario "A test case added later runs on the next run" */
    it("picks up a case filed after the first run", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      const first = await createCase({ name: "One", folderId: folder.id });
      const plan = await createPlan({
        mode: "folders",
        folderIds: [folder.id],
      });

      await runPlan(plan);
      expect(scheduledScenarioIds()).toEqual(new Set([first.id]));

      const second = await createCase({ name: "Two", folderId: folder.id });
      queueSimulationRun.mockClear();
      await runPlan(await reread(plan));

      expect(scheduledScenarioIds()).toEqual(new Set([first.id, second.id]));
    });

    /** @scenario "The resolved set is written back on the plan" */
    it("writes the cases the run covered back onto the plan", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      const filed = await createCase({ name: "One", folderId: folder.id });
      const plan = await createPlan({
        mode: "folders",
        folderIds: [folder.id],
      });
      expect(plan.scenarioIds).toEqual([]);

      await runPlan(plan);

      expect((await reread(plan)).scenarioIds).toEqual([filed.id]);
    });

    /** @scenario "A scope cannot name another project's test suite" */
    it("schedules nothing for another project's test suite", async () => {
      const foreignFolder = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId: otherProjectId,
          name: "Foreign",
          slug: `foreign-${nanoid(6)}`,
          kind: "folder",
          scenarioIds: [],
          targets: [],
          repeatCount: 1,
          labels: [],
        },
      });
      await createCase({
        name: "Foreign case",
        folderId: foreignFolder.id,
        project: otherProjectId,
      });
      await createCase({ name: "Mine" });
      const plan = await createPlan({
        mode: "folders",
        folderIds: [foreignFolder.id],
      });

      await expect(runPlan(plan)).rejects.toMatchObject({
        code: "suite_scope_empty",
      });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("when the plan covers chosen labels", () => {
    /** @scenario "A plan scoped to labels runs the cases carrying them" */
    it("runs the cases carrying one of them", async () => {
      const wanted = await createCase({
        name: "One",
        labels: ["checkout"],
      });
      await createCase({ name: "Two", labels: ["search"] });
      const plan = await createPlan({ mode: "labels", labels: ["checkout"] });

      await runPlan(plan);

      expect(scheduledScenarioIds()).toEqual(new Set([wanted.id]));
    });

    /** @scenario "A test case that loses the label drops out of the plan" */
    it("drops a case whose label was taken off", async () => {
      const dropped = await createCase({ name: "One", labels: ["checkout"] });
      const kept = await createCase({ name: "Two", labels: ["checkout"] });
      const plan = await createPlan({ mode: "labels", labels: ["checkout"] });

      await runPlan(plan);
      expect(scheduledScenarioIds()).toEqual(new Set([dropped.id, kept.id]));

      await scenarioService.update({
        id: dropped.id,
        projectId,
        data: { labels: [] },
      });
      queueSimulationRun.mockClear();
      await runPlan(await reread(plan));

      expect(scheduledScenarioIds()).toEqual(new Set([kept.id]));
    });

    /** @scenario "A dynamic scope that covers nothing is refused" */
    it("refuses a label no case carries", async () => {
      await createCase({ name: "One", labels: ["search"] });
      const plan = await createPlan({ mode: "labels", labels: ["checkout"] });

      await expect(runPlan(plan)).rejects.toMatchObject({
        code: "suite_scope_empty",
      });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("when the plan holds a hand-picked list", () => {
    /** @scenario "A plan scoped to a hand-picked list runs exactly that list" */
    it("runs the list it holds and ignores the rest", async () => {
      const held = await createCase({ name: "One" });
      await createCase({ name: "Two" });
      const agent = await createHttpAgent();
      const plan = await suiteService.create({
        projectId,
        name: `Plan ${nanoid(6)}`,
        scenarioIds: [held.id],
        scope: { mode: "cases" },
        targets: [{ type: "http", referenceId: agent.id }],
        repeatCount: 1,
        labels: [],
      });

      await runPlan(plan);

      expect(scheduledScenarioIds()).toEqual(new Set([held.id]));
    });

    /** @scenario "A plan scoped to a hand-picked list runs exactly that list" */
    it("runs the stored list when the plan carries no scope at all", async () => {
      const held = await createCase({ name: "One" });
      await createCase({ name: "Two" });
      const agent = await createHttpAgent();
      const plan = await suiteService.create({
        projectId,
        name: `Plan ${nanoid(6)}`,
        scenarioIds: [held.id],
        targets: [{ type: "http", referenceId: agent.id }],
        repeatCount: 1,
        labels: [],
      });
      expect(plan.scope).toBeNull();

      await runPlan(plan);

      expect(scheduledScenarioIds()).toEqual(new Set([held.id]));
    });
  });

  describe("when the suite is a test suite folder", () => {
    /** @scenario "A test suite refuses a scope" */
    it("refuses a scope written on it", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });

      await expect(
        suiteService.update({
          id: folder.id,
          projectId,
          data: { scope: { mode: "all" } },
        }),
      ).rejects.toMatchObject({ code: "suite_scope_not_allowed" });
    });
  });
});
