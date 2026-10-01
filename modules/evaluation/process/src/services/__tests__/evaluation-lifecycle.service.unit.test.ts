/**
 * @vitest-environment node
 * @see modules/evaluation/specs/evaluation-service.feature
 */
import type { EventingCommandSender } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type {
  RecordEvaluationLifecycleCompletedCommandData,
  RecordEvaluationRanCommandData,
} from "../../eventing/evaluation-lifecycle.events.ts";
import { EvaluationLifecycleService } from "../evaluation-lifecycle.service.ts";

const run = {
  evaluationId: "eval-1",
  evaluatorType: "langevals/exact_match",
  score: 1,
  passed: true,
};

function recorder<Payload>(sent: Payload[]): EventingCommandSender<Payload> {
  return {
    send: async (payload) => {
      sent.push(payload);
    },
    sendBatch: async (payloads) => {
      sent.push(...payloads);
    },
    close: async () => {},
    waitUntilReady: async () => {},
  };
}

function connectedService() {
  const completed: RecordEvaluationLifecycleCompletedCommandData[] = [];
  const service = EvaluationLifecycleService.create();
  service.connect({
    recordEvaluationRan: recorder<RecordEvaluationRanCommandData>([]),
    recordEvaluationLifecycleCompleted: recorder(completed),
  });
  return { service, completed };
}

describe("EvaluationLifecycleService.completed", () => {
  /** @scenario "A settled evaluation is recorded with no organization lookup" */
  it("records the settled evaluation with its project and nothing about the organization", async () => {
    const { service, completed } = connectedService();

    await service.completed({
      projectId: "project-1",
      run,
      occurredAt: 1_700_000_000_000,
    });

    expect(completed).toEqual([
      {
        tenantId: "project-1",
        occurredAt: 1_700_000_000_000,
        projectId: "project-1",
        ...run,
      },
    ]);
  });
});
