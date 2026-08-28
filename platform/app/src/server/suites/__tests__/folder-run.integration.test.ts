/**
 * @vitest-environment node
 *
 * Running a folder goes through the run plan path: the execution settings
 * travel with the request, the run plan they resolve holds them, and the
 * folder row learns nothing.
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
import { sortSuiteTargets } from "../plan-config";
import { SuiteService } from "../suite.service";
import { getSuiteSetId } from "../suite-set-id";
import type { SuiteTarget } from "../types";

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
    /** @scenario "Running a test suite schedules its active scenarios against the chosen targets" */
    it("schedules active cases x targets and lands in the run plan the run resolved", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      // A second suite keeps the run's scope a folders scope: a scope naming
      // every suite of the project is the same thing as "all scenarios" and
      // normalises to it.
      await suiteService.createFolder({ projectId, name: "Checkout" });
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
      const targets: SuiteTarget[] = [
        { type: "http", referenceId: firstAgent.id },
        { type: "http", referenceId: secondAgent.id },
      ];

      const result = await suiteService.runTestSuite({
        projectId,
        organizationId,
        folderId: folder.id,
        targets,
        idempotencyKey: `run-${nanoid(6)}`,
      });

      expect(result.jobCount).toBe(6);
      expect(queueSimulationRun).toHaveBeenCalledTimes(6);
      const scheduledScenarioIds = new Set(
        queueSimulationRun.mock.calls.map((call) => call[0].scenarioId),
      );
      expect(scheduledScenarioIds).toEqual(
        new Set(active.map((scenario) => scenario.id)),
      );
      // An archived case is outside what the scope covers, so it is not a
      // reference the run skipped: it was never named.
      expect(result.skippedArchived.scenarios).toEqual([]);

      // The batch belongs to the run plan, not to the folder.
      expect(result.created).toBe(true);
      expect(result.suiteId).not.toBe(folder.id);
      expect(result.setId).toBe(getSuiteSetId(result.suiteId));

      const nameOf = new Map([
        [firstAgent.id, firstAgent.name],
        [secondAgent.id, secondAgent.name],
      ]);
      const expectedTargets = sortSuiteTargets(targets).map((target) =>
        nameOf.get(target.referenceId),
      );
      expect(result.planName).toBe(`Refunds ${expectedTargets.join(" vs ")}`);

      const plan = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: result.suiteId, projectId },
      });
      expect(plan.kind).toBe("custom");
      expect(plan.targets).toEqual(sortSuiteTargets(targets));

      const folderRow = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: folder.id, projectId },
      });
      expect(folderRow.targets).toEqual([]);
      expect(folderRow.repeatCount).toBe(1);
      expect(folderRow.simulatorModel).toBeNull();
      expect(folderRow.judgeModel).toBeNull();
    });

    /** @scenario "The target chosen for a test suite run is offered again from the last run plan of that suite" */
    it("leaves the target on the run plan the run resolved", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      await suiteService.createFolder({ projectId, name: "Checkout" });
      await createCase({ name: "One", folderId: folder.id });
      const agent = await createHttpAgent();

      const result = await suiteService.runTestSuite({
        projectId,
        organizationId,
        folderId: folder.id,
        targets: [{ type: "http", referenceId: agent.id }],
        idempotencyKey: `run-${nanoid(6)}`,
      });

      const plan = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: result.suiteId, projectId },
      });
      expect(plan.targets).toEqual([{ type: "http", referenceId: agent.id }]);
      expect(plan.scope).toEqual({ mode: "folders", folderIds: [folder.id] });

      const folderRow = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: folder.id, projectId },
      });
      expect(folderRow.targets).toEqual([]);
    });
  });

  describe("when no target is chosen", () => {
    /** @scenario "Running a test suite with no target is refused with suite_targets_required" */
    it("refuses with suite_targets_required and schedules nothing", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      await createCase({ name: "One", folderId: folder.id });
      await createCase({ name: "Two", folderId: folder.id });

      await expect(
        suiteService.runTestSuite({
          projectId,
          organizationId,
          folderId: folder.id,
          targets: [],
          idempotencyKey: `run-${nanoid(6)}`,
        }),
      ).rejects.toMatchObject({ code: "suite_targets_required" });

      expect(startSuiteRun).not.toHaveBeenCalled();
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("when every case in the folder is archived", () => {
    /** @scenario "Running a test suite whose scenarios are all archived is refused with suite_scope_empty" */
    it("refuses with suite_scope_empty and schedules nothing", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      await suiteService.createFolder({ projectId, name: "Checkout" });
      const scenario = await createCase({ name: "Old", folderId: folder.id });
      await scenarioService.archive({ id: scenario.id, projectId });
      const agent = await createHttpAgent();

      await expect(
        suiteService.runTestSuite({
          projectId,
          organizationId,
          folderId: folder.id,
          targets: [{ type: "http", referenceId: agent.id }],
          idempotencyKey: `run-${nanoid(6)}`,
        }),
      ).rejects.toMatchObject({ code: "suite_scope_empty" });

      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("when a folder is run through the id-addressed suite path", () => {
    it("runs the targets the request carries", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      await suiteService.createFolder({ projectId, name: "Checkout" });
      await createCase({ name: "One", folderId: folder.id });
      const agent = await createHttpAgent();
      const row = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: folder.id, projectId },
      });

      const result = await suiteService.run({
        suite: row,
        projectId,
        organizationId,
        idempotencyKey: `run-${nanoid(6)}`,
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(result.jobCount).toBe(1);
      expect(result.setId).not.toBe(getSuiteSetId(folder.id));
    });

    it("refuses a folder run that carries no target", async () => {
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      await createCase({ name: "One", folderId: folder.id });
      const row = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: folder.id, projectId },
      });

      await expect(
        suiteService.run({
          suite: row,
          projectId,
          organizationId,
          idempotencyKey: `run-${nanoid(6)}`,
        }),
      ).rejects.toMatchObject({ code: "suite_targets_required" });
    });
  });

  describe("when a custom run plan spans the cases of several folders", () => {
    /** @scenario "A run plan can span the scenarios of several test suites" */
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

  describe("running all scenarios", () => {
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
      expect(managed.name).toBe("All scenarios");
      expect(managed.labels).toContain("managed:run-all");

      // A second run reuses the same managed suite, and its membership is
      // read again rather than replayed. A case added after the first run has
      // to be scheduled, and a case archived after it must not be.
      const added = await createCase({ name: "Added later" });
      await scenarioService.archive({ id: unfiled.id, projectId });
      queueSimulationRun.mockClear();

      const again = await suiteService.runAll({
        projectId,
        organizationId,
        idempotencyKey: `run-${nanoid(6)}`,
      });

      expect(again.suiteId).toBe(result.suiteId);
      expect(again.jobCount).toBe(2);
      expect(
        new Set(
          queueSimulationRun.mock.calls.map((call) => call[0].scenarioId),
        ),
      ).toEqual(new Set([filed.id, added.id]));

      const refreshed = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: result.suiteId, projectId },
      });
      expect(new Set(refreshed.scenarioIds)).toEqual(
        new Set([filed.id, added.id]),
      );
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
