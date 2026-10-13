import {
  EVALUATOR_AGGREGATE_TYPE,
  EVALUATOR_DELETED_EVENT_TYPE,
} from "@langwatch/evaluator-contract";
/**
 * @vitest-environment node
 * @unit
 * @see modules/evaluator/specs/evaluator-deleted-fact.feature
 */
import { createTenantId, type Command } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { EvaluatorDeletionFactsService } from "../../services/evaluator-deletion-facts.service.ts";
import {
  RecordEvaluatorDeletedCommand,
  type RecordEvaluatorDeletedCommandData,
} from "../evaluator-lifecycle.commands.ts";

const DELETED: RecordEvaluatorDeletedCommandData = {
  tenantId: "project-1",
  projectId: "project-1",
  evaluatorId: "evaluator-1",
  occurredAt: 1_500,
};

function command(
  data: RecordEvaluatorDeletedCommandData,
): Command<RecordEvaluatorDeletedCommandData> {
  return {
    tenantId: createTenantId(data.tenantId),
    aggregateId: data.evaluatorId,
    type: RecordEvaluatorDeletedCommand.schema.type,
    data,
  } as Command<RecordEvaluatorDeletedCommandData>;
}

describe("evaluator's deleted fact", () => {
  describe("when the same deleted command is handled twice", () => {
    /** @scenario "a redelivered evaluator deleted command records nothing new" */
    it("mints events of ids only that share one idempotency key", () => {
      const handler = new RecordEvaluatorDeletedCommand();

      const [first] = handler.handle(command(DELETED));
      const [second] = handler.handle(command(DELETED));

      expect(first?.type).toBe(EVALUATOR_DELETED_EVENT_TYPE);
      expect(first?.aggregateType).toBe(EVALUATOR_AGGREGATE_TYPE);
      expect(first?.aggregateId).toBe("evaluator-1");
      expect(first?.data).toEqual(DELETED);
      expect(first?.idempotencyKey).toBe(second?.idempotencyKey);
    });
  });

  describe("when evaluator_lifecycle is not registered in the process", () => {
    /** @scenario "an evaluator deletion outside a registered pipeline is refused by name" */
    it("refuses the record, naming the pipeline", async () => {
      const facts = EvaluatorDeletionFactsService.create();

      await expect(
        facts.recordEvaluatorDeleted({ projectId: "project-1", evaluatorId: "evaluator-1" }),
      ).rejects.toThrow("evaluator_lifecycle is not registered in this process");
    });
  });
});
