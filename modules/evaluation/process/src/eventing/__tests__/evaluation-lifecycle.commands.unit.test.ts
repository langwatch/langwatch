/**
 * @vitest-environment node
 * @see modules/evaluation/specs/evaluation-service.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordEvaluationLifecycleCompletedCommand } from "../evaluation-lifecycle.commands.ts";
import {
  RECORD_EVALUATION_LIFECYCLE_COMPLETED_COMMAND_TYPE,
  type RecordEvaluationLifecycleCompletedCommandData,
} from "../evaluation-lifecycle.events.ts";

function settled(evaluationId: string): RecordEvaluationLifecycleCompletedCommandData {
  return { tenantId: "project-1", occurredAt: 1_000, projectId: "project-1", evaluationId };
}

function recorded(payload: RecordEvaluationLifecycleCompletedCommandData) {
  return new RecordEvaluationLifecycleCompletedCommand().handle({
    tenantId: createTenantId(payload.tenantId),
    aggregateId: RecordEvaluationLifecycleCompletedCommand.getAggregateId(payload),
    type: RECORD_EVALUATION_LIFECYCLE_COMPLETED_COMMAND_TYPE,
    data: payload,
  });
}

describe("RecordEvaluationLifecycleCompletedCommand", () => {
  describe("when two evaluations in the same project settle", () => {
    /** @scenario "A settled evaluation's fact is keyed by the evaluation, not its project" */
    it("keys each fact and its queue group by its own evaluation", () => {
      const first = settled("eval-1");
      const second = settled("eval-2");

      expect(RecordEvaluationLifecycleCompletedCommand.getAggregateId(first)).toBe("eval-1");
      expect(RecordEvaluationLifecycleCompletedCommand.getAggregateId(second)).toBe("eval-2");
      expect(recorded(first).map((event) => event.aggregateId)).toEqual(["eval-1"]);
      expect(recorded(second).map((event) => event.aggregateId)).toEqual(["eval-2"]);
    });

    it("keeps the project on the fact, so its peers still know where it settled", () => {
      const [event] = recorded(settled("eval-1"));

      expect(event?.data.projectId).toBe("project-1");
    });
  });
});
