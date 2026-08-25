/**
 * @vitest-environment node
 *
 * Running a folder goes through the ordinary suite run path: same
 * scheduling, same skipped-archived reporting, same internal run set.
 *
 * @see specs/suites/folder-run-plan-reuse.feature
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
import { getSuiteSetId } from "../suite-set-id";

const projectId = `test-folder-run-${nanoid(8)}`;
const organizationId = "test-folder-run-org";

let startSuiteRun: Mock<(data: StartSuiteRunCommandData) => Promise<void>>;
let queueSimulationRun: Mock<(data: QueueRunCommandData) => Promise<void>>;
let suiteService: SuiteService;
const scenarioService = ScenarioService.create(prisma);

async function createCase({
  name,
  folderId,
}: {
  name: string;
  folderId?: string;
}) {
  return scenarioService.create({
    projectId,
    name,
    situation: "A customer asks for help",
    criteria: ["The agent helps"],
    labels: [],
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

describe("running a folder", () => {
  describe("when the folder holds active and archived cases", () => {
    /** @scenario "Running a folder schedules its active cases against the chosen targets" */
    it("schedules active cases x targets, reports the archived case skipped, and lands in the folder's run set", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      const active = [];
      for (const name of ["One", "Two", "Three"]) {
        active.push(await createCase({ name, folderId: folder.id }));
      }
      const archived = await createCase({
        name: "Old",
        folderId: folder.id,
      });
      await scenarioService.archive({ id: archived.id, projectId });

      const firstAgent = await createHttpAgent();
      const secondAgent = await createHttpAgent();
      const suite = await suiteService.update({
        id: folder.id,
        projectId,
        data: {
          targets: [
            { type: "http", referenceId: firstAgent.id },
            { type: "http", referenceId: secondAgent.id },
          ],
        },
      });

      const result = await suiteService.run({
        suite,
        projectId,
        organizationId,
        idempotencyKey: `run-${nanoid(6)}`,
      });

      expect(result.jobCount).toBe(6);
      expect(queueSimulationRun).toHaveBeenCalledTimes(6);
      expect(result.skippedArchived.scenarios).toEqual([archived.id]);
      expect(result.setId).toBe(getSuiteSetId(folder.id));
      const scheduledScenarioIds = new Set(
        queueSimulationRun.mock.calls.map((call) => call[0].scenarioId),
      );
      expect(scheduledScenarioIds).toEqual(
        new Set(active.map((scenario) => scenario.id)),
      );
    });
  });

  describe("when no target is chosen", () => {
    /** @scenario "Running a folder with no target is refused with suite_targets_required" */
    it("refuses with suite_targets_required and schedules nothing", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      await createCase({ name: "One", folderId: folder.id });
      await createCase({ name: "Two", folderId: folder.id });
      const suite = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: folder.id, projectId },
      });

      await expect(
        suiteService.run({
          suite,
          projectId,
          organizationId,
          idempotencyKey: `run-${nanoid(6)}`,
        }),
      ).rejects.toMatchObject({ code: "suite_targets_required" });

      expect(startSuiteRun).not.toHaveBeenCalled();
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("when every case in the folder is archived", () => {
    /** @scenario "Running a folder whose cases are all archived is refused with suite_all_scenarios_archived" */
    it("refuses with suite_all_scenarios_archived and schedules nothing", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      const scenario = await createCase({ name: "Old", folderId: folder.id });
      await scenarioService.archive({ id: scenario.id, projectId });
      const agent = await createHttpAgent();
      const suite = await suiteService.update({
        id: folder.id,
        projectId,
        data: { targets: [{ type: "http", referenceId: agent.id }] },
      });

      await expect(
        suiteService.run({
          suite,
          projectId,
          organizationId,
          idempotencyKey: `run-${nanoid(6)}`,
        }),
      ).rejects.toMatchObject({ code: "suite_all_scenarios_archived" });

      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("when a custom run plan spans the cases of several folders", () => {
    /** @scenario "A custom run plan can span the cases of several folders" */
    it("runs the four cases and changes neither folder", async () => {
      const refunds = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      const checkout = await suiteService.createFolder({
        projectId,
        name: "Checkout",
      });
      const cases = [];
      for (const [name, folderId] of [
        ["R1", refunds.id],
        ["R2", refunds.id],
        ["C1", checkout.id],
        ["C2", checkout.id],
      ] as const) {
        cases.push(await createCase({ name, folderId }));
      }
      const agent = await createHttpAgent();
      const plan = await suiteService.create({
        projectId,
        name: "Cross folder nightly",
        scenarioIds: cases.map((scenario) => scenario.id),
        targets: [{ type: "http", referenceId: agent.id }],
        repeatCount: 1,
        labels: [],
      });

      expect(plan.scenarioIds).toHaveLength(4);
      const result = await suiteService.run({
        suite: plan,
        projectId,
        organizationId,
        idempotencyKey: `run-${nanoid(6)}`,
      });

      expect(result.jobCount).toBe(4);
      const refundsRow = await prisma.simulationSuite.findFirst({
        where: { id: refunds.id, projectId },
      });
      const checkoutRow = await prisma.simulationSuite.findFirst({
        where: { id: checkout.id, projectId },
      });
      expect([...(refundsRow?.scenarioIds ?? [])].sort()).toEqual(
        [cases[0]!.id, cases[1]!.id].sort(),
      );
      expect([...(checkoutRow?.scenarioIds ?? [])].sort()).toEqual(
        [cases[2]!.id, cases[3]!.id].sort(),
      );
    });
  });

  describe("running all test cases", () => {
    it("creates the managed suite once, refreshes it, and schedules every active case", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      const filed = await createCase({ name: "Filed", folderId: folder.id });
      const unfiled = await createCase({ name: "Unfiled" });
      const archived = await createCase({ name: "Archived" });
      await scenarioService.archive({ id: archived.id, projectId });
      const agent = await createHttpAgent();

      const result = await suiteService.runAll({
        projectId,
        organizationId,
        idempotencyKey: `run-${nanoid(6)}`,
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(result.jobCount).toBe(2);
      const scheduled = new Set(
        queueSimulationRun.mock.calls.map((call) => call[0].scenarioId),
      );
      expect(scheduled).toEqual(new Set([filed.id, unfiled.id]));

      const managed = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: result.suiteId, projectId },
      });
      expect(managed.name).toBe("All test cases");
      expect(managed.labels).toContain("managed:run-all");

      // A second run reuses the same managed suite with refreshed members.
      const again = await suiteService.runAll({
        projectId,
        organizationId,
        idempotencyKey: `run-${nanoid(6)}`,
      });
      expect(again.suiteId).toBe(result.suiteId);
    });

    it("refuses with suite_targets_required when no target was ever chosen", async () => {
      await createCase({ name: "Unfiled" });

      await expect(
        suiteService.runAll({
          projectId,
          organizationId,
          idempotencyKey: `run-${nanoid(6)}`,
        }),
      ).rejects.toMatchObject({ code: "suite_targets_required" });

      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });
});
