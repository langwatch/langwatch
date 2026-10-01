// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { ProjectCreatedEventData } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { NurturingMilestonesService } from "../nurturing-milestones.service.ts";

function serviceOver() {
  const claimed = new Set<string>();
  return NurturingMilestonesService.create({
    milestones: MemoryNurturingMilestonesRepository.create(),
    claims: {
      claim: async (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    },
  });
}

function created(overrides: Partial<ProjectCreatedEventData> = {}): ProjectCreatedEventData {
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
    await service.projectCreated(created());

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
    await service.projectCreated(created({ backfilled: true }));

    expect(await service.evaluationCompleted(settled("eval-1"))).toMatchObject([
      { first: false, organizationEvaluationCount: 1 },
    ]);
  });

  /** @scenario "Project's backfill is idempotent for nurturing" */
  it("keeps a live organization unseeded when the backfill records its project again", async () => {
    const service = serviceOver();
    await service.projectCreated(created());
    await service.projectCreated(created({ backfilled: true }));
    await service.projectCreated(created({ backfilled: true }));

    expect(await service.evaluationCompleted(settled("eval-1"))).toMatchObject([
      { first: true, organizationEvaluationCount: 1 },
    ]);
  });

  it("counts a redelivered completion once", async () => {
    const service = serviceOver();
    await service.projectCreated(created());
    await service.evaluationCompleted(settled("eval-1"));

    expect(await service.evaluationCompleted(settled("eval-1"))).toEqual([]);
    expect(await service.evaluationCompleted(settled("eval-2"))).toMatchObject([
      { organizationEvaluationCount: 2 },
    ]);
  });

  it("raises nothing for a project it has not learned", async () => {
    expect(await serviceOver().evaluationCompleted(settled("eval-1"))).toEqual([]);
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
    await service.projectCreated(created());

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
    await service.projectCreated(created({ adminUserId: null }));

    expect(await service.simulationRunFinished(finished("run-1"))).toEqual([]);
  });

  it("counts a redelivered run once and never fires the first for a backfilled organization", async () => {
    const service = serviceOver();
    await service.projectCreated(created({ backfilled: true }));
    await service.simulationRunFinished(finished("run-1"));

    expect(await service.simulationRunFinished(finished("run-1"))).toEqual([]);
    expect(await service.simulationRunFinished(finished("run-2"))).toMatchObject([
      { organizationRunCount: 2, first: false },
    ]);
  });
});
