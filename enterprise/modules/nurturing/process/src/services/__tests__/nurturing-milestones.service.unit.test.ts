// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { ProjectCreatedEventData } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import type { NurturingMilestonesRepository } from "../../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../../repositories/nurturing-project-directory.repository.ts";
import { NURTURING_CUTOVER_AT } from "../../rules/nurturing-owner-signals.rules.ts";
import { NurturingMilestonesService } from "../nurturing-milestones.service.ts";

/** `placed` and `created` stand in for project's and organization's tables (R40). */
function serviceOver({
  placed = new Map([["project-1", "org-1"]]),
  created,
  milestones = MemoryNurturingMilestonesRepository.create(),
  projects = MemoryNurturingProjectDirectoryRepository.create({ placed, created }),
}: {
  placed?: ReadonlyMap<string, string>;
  created?: ReadonlyMap<string, number>;
  milestones?: NurturingMilestonesRepository;
  projects?: NurturingProjectDirectoryRepository;
} = {}) {
  const claimed = new Set<string>();
  return NurturingMilestonesService.create({
    milestones,
    projects,
    claims: {
      claim: async (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      release: async (key) => void claimed.delete(key),
    },
  });
}

function projectCreatedFact(
  overrides: Partial<ProjectCreatedEventData> = {},
): ProjectCreatedEventData {
  return {
    tenantId: "project-1",
    projectId: "project-1",
    organizationId: "org-1",
    occurredAt: 1,
    adminUserId: "admin-1",
    ...overrides,
  };
}

function settled(
  evaluationId: string,
  overrides: Partial<EvaluationLifecycleCompletedEventData> = {},
): EvaluationLifecycleCompletedEventData {
  return {
    tenantId: "project-1",
    occurredAt: 2,
    projectId: "project-1",
    evaluationId,
    ...overrides,
  };
}

/** One batch of settled evaluations, as a backed-up project's lane hands it over. */
async function settleAndCount(
  service: NurturingMilestonesService,
  ...evaluations: EvaluationLifecycleCompletedEventData[]
): Promise<NurturingSignal[]> {
  const delivered: NurturingSignal[] = [];
  await service.evaluationsCompleted({
    evaluations,
    deliver: async (signal) => void delivered.push(signal),
  });
  return delivered;
}

/** One batch of finished runs, answering the signals it delivered. */
async function runsFinished(
  service: NurturingMilestonesService,
  runs: Parameters<NurturingMilestonesService["simulationRunsFinished"]>[0]["runs"],
): Promise<NurturingSignal[]> {
  const delivered: NurturingSignal[] = [];
  await service.simulationRunsFinished({
    runs,
    deliver: async (signal) => void delivered.push(signal),
  });
  return delivered;
}

describe("NurturingMilestonesService", () => {
  /** @scenario "The evaluation milestone names the admin from project's created event" */
  it("names the admin project's created event carried and fires the first once", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact());

    const first = await settleAndCount(service, settled("eval-1"));
    const second = await settleAndCount(service, settled("eval-2"));

    expect(first).toMatchObject([
      { userId: "admin-1", first: true, organizationEvaluationCount: 1 },
    ]);
    expect(second).toMatchObject([{ first: false, organizationEvaluationCount: 2 }]);
  });

  /** @scenario "A seeded organization's first counted evaluation is not its first milestone" */
  it("never fires the first for an organization learned from the backfill", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact({ backfilled: true }));

    expect(await settleAndCount(service, settled("eval-1"))).toMatchObject([
      { first: false, organizationEvaluationCount: 1 },
    ]);
  });

  /** @scenario "Project's backfill is idempotent for nurturing" */
  it("keeps a live organization unseeded when the backfill records its project again", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact());
    await service.projectCreated(projectCreatedFact({ backfilled: true }));
    await service.projectCreated(projectCreatedFact({ backfilled: true }));

    expect(await settleAndCount(service, settled("eval-1"))).toMatchObject([
      { first: true, organizationEvaluationCount: 1 },
    ]);
  });

  it("raises nothing for a project its owners do not hold", async () => {
    const service = serviceOver({ placed: new Map() });
    await service.projectCreated(projectCreatedFact());

    expect(await settleAndCount(service, settled("eval-1"))).toEqual([]);
  });

  /** @scenario "An evaluation in an organization nurturing never learned raises nothing" */
  it("raises nothing for a placed project whose organization it never learned", async () => {
    expect(await settleAndCount(serviceOver(), settled("eval-1"))).toEqual([]);
  });

  /** @scenario "An evaluation in a project nurturing never saw created counts toward its organization" */
  it("counts an evaluation in a project created before the cutover toward its organization", async () => {
    const service = serviceOver({
      placed: new Map([
        ["project-1", "org-1"],
        ["project-old", "org-1"],
      ]),
    });
    await service.projectCreated(projectCreatedFact());

    const counted = await settleAndCount(
      service,
      settled("eval-1", { tenantId: "project-old", projectId: "project-old" }),
    );

    expect(counted).toMatchObject([{ userId: "admin-1", organizationEvaluationCount: 1 }]);
  });

  describe("when a backed-up project's settled evaluations arrive as one batch", () => {
    /** @scenario "A backed-up project's settled evaluations are counted in one step and send one update" */
    it("counts the project's three evaluations in one step and raises one signal", async () => {
      const service = serviceOver();
      await service.projectCreated(projectCreatedFact({ backfilled: true }));

      const signals = await settleAndCount(
        service,
        settled("eval-1", { occurredAt: 10 }),
        settled("eval-2", { occurredAt: 30, score: 0.5 }),
        settled("eval-3", { occurredAt: 20 }),
      );

      expect(signals).toEqual([
        {
          kind: "evaluation_completed",
          sourceEventId: "project-1:eval-2",
          tenantId: "project-1",
          occurredAt: 30,
          userId: "admin-1",
          projectId: "project-1",
          evaluationId: "eval-2",
          evaluatorType: undefined,
          score: 0.5,
          passed: undefined,
          evaluationsCounted: 3,
          organizationEvaluationCount: 3,
          first: false,
        },
      ]);
    });

    /** @scenario "The batch that counts an organization's first evaluations sends its milestone once" */
    it("marks the batch that counts an organization's first evaluations as its first, once", async () => {
      const service = serviceOver();
      await service.projectCreated(projectCreatedFact());

      const firstBatch = await settleAndCount(service, settled("eval-1"), settled("eval-2"));
      const nextBatch = await settleAndCount(service, settled("eval-3"));

      expect(firstBatch).toMatchObject([
        { userId: "admin-1", first: true, evaluationsCounted: 2, organizationEvaluationCount: 2 },
      ]);
      expect(nextBatch).toMatchObject([{ first: false, organizationEvaluationCount: 3 }]);
    });

    /** @scenario "A redelivered settled evaluation is counted once" */
    it("counts an evaluation redelivered inside a batch or in a later one once", async () => {
      const service = serviceOver();
      await service.projectCreated(projectCreatedFact());

      expect(
        await settleAndCount(service, settled("eval-1"), settled("eval-1"), settled("eval-2")),
      ).toMatchObject([{ evaluationsCounted: 2, organizationEvaluationCount: 2 }]);
      expect(await settleAndCount(service, settled("eval-2"))).toEqual([]);
    });

    it("raises one signal per project when a batch spans projects", async () => {
      const service = serviceOver({
        placed: new Map([
          ["project-1", "org-1"],
          ["project-2", "org-2"],
        ]),
      });
      await service.projectCreated(projectCreatedFact());
      await service.projectCreated(
        projectCreatedFact({
          projectId: "project-2",
          organizationId: "org-2",
          adminUserId: "admin-2",
        }),
      );

      expect(
        await settleAndCount(
          service,
          settled("eval-1"),
          settled("eval-2", { tenantId: "project-2", projectId: "project-2" }),
          settled("eval-3"),
        ),
      ).toMatchObject([
        { projectId: "project-1", evaluationsCounted: 2 },
        { projectId: "project-2", userId: "admin-2", evaluationsCounted: 1 },
      ]);
    });
  });

  describe("when counting a batch fails", () => {
    /** @scenario "A batch that fails counting is retried without counting twice" */
    it("gives a failed project's claims back, so the retry counts it once", async () => {
      const memory = MemoryNurturingMilestonesRepository.create();
      let failuresLeft = 1;
      const milestones: NurturingMilestonesRepository = {
        recordOrganization: (input) => memory.recordOrganization(input),
        countSimulationRun: (input) => memory.countSimulationRun(input),
        countEvaluation: async (input) => {
          if (input.organizationId === "org-1" && failuresLeft > 0) {
            failuresLeft -= 1;
            throw new Error("database unavailable");
          }
          return memory.countEvaluation(input);
        },
      };
      const service = serviceOver({
        milestones,
        placed: new Map([
          ["project-1", "org-1"],
          ["project-2", "org-2"],
        ]),
      });
      await service.projectCreated(projectCreatedFact());
      await service.projectCreated(
        projectCreatedFact({
          projectId: "project-2",
          organizationId: "org-2",
          adminUserId: "admin-2",
        }),
      );
      const batch = [
        settled("eval-1"),
        settled("eval-2", { tenantId: "project-2", projectId: "project-2" }),
      ];
      const delivered: NurturingSignal[] = [];
      const deliver = async (signal: NurturingSignal) => void delivered.push(signal);

      await expect(service.evaluationsCompleted({ evaluations: batch, deliver })).rejects.toThrow();
      expect(delivered).toMatchObject([{ projectId: "project-2", organizationEvaluationCount: 1 }]);

      await service.evaluationsCompleted({ evaluations: batch, deliver });
      expect(delivered).toMatchObject([
        { projectId: "project-2", organizationEvaluationCount: 1 },
        { projectId: "project-1", organizationEvaluationCount: 1 },
      ]);
    });

    it("never counts twice when the read before the count fails", async () => {
      const milestones = MemoryNurturingMilestonesRepository.create();
      const directory = MemoryNurturingProjectDirectoryRepository.create({
        placed: new Map([["project-1", "org-1"]]),
      });
      let failuresLeft = 1;
      const projects: NurturingProjectDirectoryRepository = {
        getPlacement: (input) => directory.getPlacement(input),
        getFirstProjectCreatedAt: async (input) => {
          if (failuresLeft-- > 0) throw new Error("database unavailable");
          return directory.getFirstProjectCreatedAt(input);
        },
      };
      const service = serviceOver({ milestones, projects });
      await service.projectCreated(projectCreatedFact());

      await expect(settleAndCount(service, settled("eval-1"))).rejects.toThrow();
      expect(await settleAndCount(service, settled("eval-1"))).toMatchObject([
        { organizationEvaluationCount: 1 },
      ]);
    });
  });
});

describe("given an organization that held a project before nurturing's cutover", () => {
  const placed = new Map([
    ["project-1", "org-1"],
    ["project-old", "org-1"],
  ]);
  const created = new Map([
    ["project-1", NURTURING_CUTOVER_AT + 1],
    ["project-old", NURTURING_CUTOVER_AT - 1],
  ]);

  /** @scenario "An organization that held a project before the cutover never gets a first milestone" */
  it("sends no first evaluation or first run for its new project, though stored unseeded", async () => {
    const service = serviceOver({ placed, created });
    await service.projectCreated(projectCreatedFact({ backfilled: false }));

    expect(await settleAndCount(service, settled("eval-1"))).toMatchObject([
      { first: false, organizationEvaluationCount: 1 },
    ]);
    expect(
      await runsFinished(service, [
        {
          aggregateId: "run-1",
          tenantId: "project-1",
          data: { scenarioRunId: "run-1", occurredAt: 3 },
        },
      ]),
    ).toMatchObject([{ first: false, organizationRunCount: 1 }]);
  });

  /** @scenario "An organization whose projects all came after the cutover still gets its first milestone" */
  it("still sends the first once where every project came after the cutover", async () => {
    const service = serviceOver({
      placed,
      created: new Map([
        ["project-1", NURTURING_CUTOVER_AT + 1],
        ["project-old", NURTURING_CUTOVER_AT],
      ]),
    });
    await service.projectCreated(projectCreatedFact());

    expect(await settleAndCount(service, settled("eval-1"))).toMatchObject([{ first: true }]);
    expect(await settleAndCount(service, settled("eval-2"))).toMatchObject([{ first: false }]);
  });
});

/** @see modules/scenario/specs/simulation-run-finished-nurturing-signal.feature */
describe("NurturingMilestonesService.simulationRunsFinished", () => {
  function finished(runId: string, occurredAt = 3) {
    return {
      aggregateId: runId,
      tenantId: "project-1",
      data: { scenarioRunId: runId, occurredAt },
    };
  }

  /** @scenario "A finished run tells nurturing the organization's run count so far" */
  it("tells the run against the admin with the organization's count, the first once", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact());

    expect(await runsFinished(service, [finished("run-1")])).toEqual([
      {
        kind: "simulation_run_finished",
        sourceEventId: "run-1",
        tenantId: "project-1",
        occurredAt: 3,
        userId: "admin-1",
        projectId: "project-1",
        organizationRunCount: 1,
        first: true,
      },
    ]);
    expect(await runsFinished(service, [finished("run-2")])).toMatchObject([
      { organizationRunCount: 2, first: false },
    ]);
  });

  /** @scenario "A finished run in a project with no organization admin tells nurturing nothing" */
  it("tells nothing when the organization has no admin", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact({ adminUserId: null }));

    expect(await runsFinished(service, [finished("run-1")])).toEqual([]);
  });

  it("counts a redelivered run once and never fires the first for a backfilled organization", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact({ backfilled: true }));
    await runsFinished(service, [finished("run-1")]);

    expect(await runsFinished(service, [finished("run-1")])).toEqual([]);
    expect(await runsFinished(service, [finished("run-2")])).toMatchObject([
      { organizationRunCount: 2, first: false },
    ]);
  });

  /** @scenario "A backed-up project's finished runs are counted in one step" */
  it("counts a batch of runs in one step under the latest run, each run once", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact());

    expect(
      await runsFinished(service, [
        finished("run-1", 3),
        finished("run-2", 9),
        finished("run-1", 3),
      ]),
    ).toMatchObject([{ sourceEventId: "run-2", organizationRunCount: 2, first: true }]);
  });
});
