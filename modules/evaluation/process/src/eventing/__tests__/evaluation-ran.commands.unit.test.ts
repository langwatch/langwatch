/**
 * @vitest-environment node
 * @see modules/evaluation/specs/evaluation-service.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordEvaluationRanCommand } from "../evaluation-lifecycle.commands.ts";
import {
  RECORD_EVALUATION_RAN_COMMAND_TYPE,
  type RecordEvaluationRanCommandData,
} from "../evaluation-lifecycle.events.ts";

function ran(userId: string, occurredAt: number): RecordEvaluationRanCommandData {
  return { tenantId: "project-1", occurredAt, userId, projectId: "project-1" };
}

function recorded(payload: RecordEvaluationRanCommandData) {
  return new RecordEvaluationRanCommand().handle({
    tenantId: createTenantId(payload.tenantId),
    aggregateId: RecordEvaluationRanCommand.getAggregateId(payload),
    type: RECORD_EVALUATION_RAN_COMMAND_TYPE,
    data: payload,
  });
}

describe("RecordEvaluationRanCommand", () => {
  describe("when two people in the same project run an evaluation by hand", () => {
    /** @scenario "A hand-run evaluation's fact is keyed by the run, not its project" */
    it("keys each fact by its person and instant, and one run sent twice the same", () => {
      const [first] = recorded(ran("user-1", 1_000));
      const [second] = recorded(ran("user-2", 1_000));
      const [again] = recorded(ran("user-1", 1_000));

      expect(first?.aggregateId).toBe("user-1:1000");
      expect(second?.aggregateId).toBe("user-2:1000");
      expect(again?.idempotencyKey).toBe(first?.idempotencyKey);
      expect(first?.data.projectId).toBe("project-1");
    });
  });
});
