import {
  EVALUATOR_AGGREGATE_TYPE,
  EVALUATOR_CREATED_EVENT_TYPE,
  EVALUATOR_CREATED_EVENT_VERSION,
  EVALUATOR_DELETED_EVENT_TYPE,
} from "@langwatch/evaluator-contract";
/**
 * @vitest-environment node
 * @unit
 * @see modules/evaluator/specs/evaluator-deleted-fact.feature
 * @see modules/evaluator/specs/evaluator-created-fact.feature
 */
import { createTenantId, type Command } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { EvaluatorLifecycleFactsService } from "../../services/evaluator-lifecycle-facts.service.ts";
import {
  RecordEvaluatorCreatedCommand,
  RecordEvaluatorDeletedCommand,
  type RecordEvaluatorCreatedCommandData,
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
      const facts = EvaluatorLifecycleFactsService.create();

      await expect(
        facts.recordEvaluatorDeleted({ projectId: "project-1", evaluatorId: "evaluator-1" }),
      ).rejects.toThrow("evaluator_lifecycle is not registered in this process");
    });
  });
});

describe("evaluator's created fact", () => {
  describe("when the same created command is handled twice", () => {
    /** @scenario "a redelivered evaluator created command records nothing new" */
    it("mints dated events of ids only that share one idempotency key", () => {
      const handler = new RecordEvaluatorCreatedCommand();
      const created: RecordEvaluatorCreatedCommandData = { ...DELETED, occurredAt: 1_000 };
      const redelivered: RecordEvaluatorCreatedCommandData = { ...DELETED, occurredAt: 2_000 };
      const toCommand = (data: RecordEvaluatorCreatedCommandData) =>
        ({
          tenantId: createTenantId(data.tenantId),
          aggregateId: data.evaluatorId,
          type: RecordEvaluatorCreatedCommand.schema.type,
          data,
        }) as Command<RecordEvaluatorCreatedCommandData>;

      const [first] = handler.handle(toCommand(created));
      const [second] = handler.handle(toCommand(redelivered));

      expect(first?.type).toBe(EVALUATOR_CREATED_EVENT_TYPE);
      expect(first?.version).toBe(EVALUATOR_CREATED_EVENT_VERSION);
      expect(first?.aggregateType).toBe(EVALUATOR_AGGREGATE_TYPE);
      expect(first?.aggregateId).toBe("evaluator-1");
      expect(first?.data).toEqual(created);
      expect(first?.idempotencyKey).toBe(second?.idempotencyKey);
    });
  });
});
