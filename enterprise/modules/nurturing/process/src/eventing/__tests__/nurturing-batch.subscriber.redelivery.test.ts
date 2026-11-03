// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * Redelivery: the same settled evaluation handed to a batch lane twice is counted and told once.
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import {
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  type EvaluationLifecycleCompletedEventData,
  evaluationLifecycleCompletedEventDataSchema,
} from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { NurturingMilestonesService } from "../../services/nurturing-milestones.service.ts";
import { nurturingBatchLane } from "../nurturing-batch.subscriber.ts";

function laneOverMemory() {
  const claimed = new Set<string>();
  const service = NurturingMilestonesService.create({
    milestones: MemoryNurturingMilestonesRepository.create(),
    projects: MemoryNurturingProjectDirectoryRepository.create({
      placed: new Map([["project-1", "org-1"]]),
    }),
    claims: {
      claim: async (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      release: async (key) => void claimed.delete(key),
    },
  });
  const delivered: NurturingSignal[] = [];
  const lane = nurturingBatchLane({
    eventType: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
    data: evaluationLifecycleCompletedEventDataSchema,
    handleBatch: (items) =>
      service.evaluationsCompleted({
        evaluations: items.map(({ data }) => data),
        deliver: async (signal) => void delivered.push(signal),
      }),
  });
  return { service, lane, delivered };
}

const settled: EvaluationLifecycleCompletedEventData = {
  tenantId: "project-1",
  occurredAt: 2,
  projectId: "project-1",
  evaluationId: "eval-1",
};

const item = {
  data: settled,
  context: {
    tenantId: "project-1",
    aggregateId: "eval-1",
    occurredAt: 2,
    createdAt: 2,
    eventId: "evt-eval-1",
  },
};

describe("nurturingBatchLane", () => {
  describe("when the same settled evaluation is delivered twice", () => {
    it("counts it once and raises one signal", async () => {
      const { service, lane, delivered } = laneOverMemory();
      await service.projectCreated({
        tenantId: "project-1",
        projectId: "project-1",
        organizationId: "org-1",
        occurredAt: 1,
        adminUserId: "admin-1",
      });

      await lane.handleBatch([item]);
      await lane.handleBatch([item]);

      expect(delivered).toMatchObject([{ organizationEvaluationCount: 1 }]);
    });
  });
});
