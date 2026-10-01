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
