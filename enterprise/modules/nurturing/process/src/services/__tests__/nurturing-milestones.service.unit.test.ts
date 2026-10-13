// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { ProjectCreatedEventData } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { NURTURING_CUTOVER_AT } from "../../rules/nurturing-owner-signals.rules.ts";
import { NurturingMilestonesService } from "../nurturing-milestones.service.ts";

/** `placed` and `created` stand in for project's and organization's tables (R40). */
function serviceOver({
  placed = new Map([["project-1", "org-1"]]),
  created,
}: { placed?: ReadonlyMap<string, string>; created?: ReadonlyMap<string, number> } = {}) {
  const claimed = new Set<string>();
  return NurturingMilestonesService.create({
    milestones: MemoryNurturingMilestonesRepository.create(),
    projects: MemoryNurturingProjectDirectoryRepository.create({ placed, created }),
    claims: {
      claim: async (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
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

function settled(evaluationId: string): {
  data: EvaluationLifecycleCompletedEventData;
  aggregateId: string;
} {
  return {
    aggregateId: `project-1:${evaluationId}`,
    data: { tenantId: "project-1", occurredAt: 2, projectId: "project-1", evaluationId },
  };
}

describe("NurturingMilestonesService", () => {
  /** @scenario "The evaluation milestone names the admin from project's created event" */
  it("names the admin project's created event carried and fires the first once", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact());

    const first = await service.evaluationCompleted(settled("eval-1"));
    const second = await service.evaluationCompleted(settled("eval-2"));

    expect(first).toMatchObject([
      { userId: "admin-1", first: true, organizationEvaluationCount: 1 },
    ]);
    expect(second).toMatchObject([{ first: false, organizationEvaluationCount: 2 }]);
  });

  /** @scenario "A seeded organization's first counted evaluation is not its first milestone" */
  it("never fires the first for an organization learned from the backfill", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact({ backfilled: true }));

    expect(await service.evaluationCompleted(settled("eval-1"))).toMatchObject([
      { first: false, organizationEvaluationCount: 1 },
    ]);
  });

  /** @scenario "Project's backfill is idempotent for nurturing" */
  it("keeps a live organization unseeded when the backfill records its project again", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact());
    await service.projectCreated(projectCreatedFact({ backfilled: true }));
    await service.projectCreated(projectCreatedFact({ backfilled: true }));

    expect(await service.evaluationCompleted(settled("eval-1"))).toMatchObject([
      { first: true, organizationEvaluationCount: 1 },
    ]);
  });

  it("counts a redelivered completion once", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact());
    await service.evaluationCompleted(settled("eval-1"));

    expect(await service.evaluationCompleted(settled("eval-1"))).toEqual([]);
    expect(await service.evaluationCompleted(settled("eval-2"))).toMatchObject([
      { organizationEvaluationCount: 2 },
    ]);
  });

  it("raises nothing for a project its owners do not hold", async () => {
    const service = serviceOver({ placed: new Map() });
    await service.projectCreated(projectCreatedFact());

    expect(await service.evaluationCompleted(settled("eval-1"))).toEqual([]);
  });

  /** @scenario "An evaluation in an organization nurturing never learned raises nothing" */
  it("raises nothing for a placed project whose organization it never learned", async () => {
    expect(await serviceOver().evaluationCompleted(settled("eval-1"))).toEqual([]);
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

    const counted = await service.evaluationCompleted({
      aggregateId: "project-old:eval-1",
      data: {
        tenantId: "project-old",
        occurredAt: 2,
        projectId: "project-old",
        evaluationId: "eval-1",
      },
    });

    expect(counted).toMatchObject([{ userId: "admin-1", organizationEvaluationCount: 1 }]);
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

    expect(await service.evaluationCompleted(settled("eval-1"))).toMatchObject([
      { first: false, organizationEvaluationCount: 1 },
    ]);
    expect(
      await service.simulationRunFinished({
        aggregateId: "run-1",
        tenantId: "project-1",
        data: { scenarioRunId: "run-1", occurredAt: 3 },
      }),
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

    expect(await service.evaluationCompleted(settled("eval-1"))).toMatchObject([{ first: true }]);
    expect(await service.evaluationCompleted(settled("eval-2"))).toMatchObject([{ first: false }]);
  });
});

/** @see modules/scenario/specs/simulation-run-finished-nurturing-signal.feature */
describe("NurturingMilestonesService.simulationRunFinished", () => {
  function finished(runId: string) {
    return {
      aggregateId: runId,
      tenantId: "project-1",
      data: { scenarioRunId: runId, occurredAt: 3 },
    };
  }

  /** @scenario "A finished run tells nurturing the organization's run count so far" */
  it("tells the run against the admin with the organization's count, the first once", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact());

    expect(await service.simulationRunFinished(finished("run-1"))).toEqual([
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
    expect(await service.simulationRunFinished(finished("run-2"))).toMatchObject([
      { organizationRunCount: 2, first: false },
    ]);
  });

  /** @scenario "A finished run in a project with no organization admin tells nurturing nothing" */
  it("tells nothing when the organization has no admin", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact({ adminUserId: null }));

    expect(await service.simulationRunFinished(finished("run-1"))).toEqual([]);
  });

  it("counts a redelivered run once and never fires the first for a backfilled organization", async () => {
    const service = serviceOver();
    await service.projectCreated(projectCreatedFact({ backfilled: true }));
    await service.simulationRunFinished(finished("run-1"));

    expect(await service.simulationRunFinished(finished("run-1"))).toEqual([]);
    expect(await service.simulationRunFinished(finished("run-2"))).toMatchObject([
      { organizationRunCount: 2, first: false },
    ]);
  });
});
