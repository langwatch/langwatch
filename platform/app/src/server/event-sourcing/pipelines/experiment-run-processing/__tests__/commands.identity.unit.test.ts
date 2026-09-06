/**
 * @see specs/experiments-v3/execution-backend.feature - Verdict Identity
 *
 * The identity of a recorded verdict is what `event_log` orders on, and that
 * table is a ReplacingMergeTree. Two rows sharing an identity become one row.
 *
 * Every evaluator runs against every target, so a run with two columns produces
 * two verdicts for the same evaluator on the same row. They are different
 * facts. While the identity left the target out, one of them replaced the other
 * on the way to storage, and the results page drew that column with its output
 * and its cost but no score at all.
 */
import { describe, expect, it } from "vitest";
import type { Command, CommandHandlerResult } from "../../../commands/command";
import type { CommandEnvelope } from "../../../commands/commandEnvelope";
import { createTenantId } from "../../../domain/tenantId";
import type { Event } from "../../../domain/types";
import {
  RecordEvaluatorResultCommand,
  RecordTargetResultCommand,
} from "../commands";
import type {
  EvaluatorResultEventData,
  TargetResultEventData,
} from "../schemas/events";

const TENANT = createTenantId("project_test");
const RUN = "bold-jolly-bee";
const EXPERIMENT = "experiment_1";
const OCCURRED_AT = 1_700_000_000_000;

const verdict = ({
  targetId,
  evaluatorId = "category_l3_exact",
  index = 0,
  passed = true,
}: {
  targetId: string;
  evaluatorId?: string;
  index?: number;
  passed?: boolean;
}): Command<EvaluatorResultEventData & CommandEnvelope> => ({
  tenantId: TENANT,
  aggregateId: `${EXPERIMENT}:${RUN}`,
  type: "lw.experiment_run.record_evaluator_result",
  data: {
    tenantId: TENANT,
    occurredAt: OCCURRED_AT,
    runId: RUN,
    experimentId: EXPERIMENT,
    index,
    targetId,
    evaluatorId,
    status: "processed",
    passed,
  },
});

const output = (
  targetId: string,
): Command<TargetResultEventData & CommandEnvelope> => ({
  tenantId: TENANT,
  aggregateId: `${EXPERIMENT}:${RUN}`,
  type: "lw.experiment_run.record_target_result",
  data: {
    tenantId: TENANT,
    occurredAt: OCCURRED_AT,
    runId: RUN,
    experimentId: EXPERIMENT,
    index: 0,
    targetId,
    entry: { question: "what is the capital of France?" },
  },
});

/**
 * The identity the store orders on, for one recorded event.
 *
 * `handle` is declared as `Promise<Event[]> | Event[]` for handlers that need
 * to read state first. These two build their event from the payload alone and
 * answer at once, so the array is taken directly.
 */
const identityOfEvent = (result: CommandHandlerResult<Event>): string => {
  const [event] = result as Event[];
  return (event as { idempotencyKey: string }).idempotencyKey;
};

/** The identity the store orders on, for one recorded verdict. */
const identityOf = (command: ReturnType<typeof verdict>): string =>
  identityOfEvent(new RecordEvaluatorResultCommand().handle(command));

describe("given a run whose two columns share one evaluator", () => {
  describe("when both columns produce a verdict for the same row", () => {
    /** @scenario "Two columns keep their own score for the same evaluator and row" */
    it("gives each column its own identity, so neither replaces the other", () => {
      const first = identityOf(verdict({ targetId: "target-eyMC-VVJ" }));
      const second = identityOf(verdict({ targetId: "target-YyznMusS" }));

      expect(first).not.toBe(second);
    });

    /** @scenario "Two columns keep their own score for the same evaluator and row" */
    it("names the target in the identity, not only the evaluator and the row", () => {
      // Asserting the target is present, rather than only that two keys differ,
      // is what stops a later rewrite from separating them by something that is
      // not stable across a retry.
      expect(identityOf(verdict({ targetId: "target-YyznMusS" }))).toContain(
        "target-YyznMusS",
      );
    });

    /** @scenario "Two columns keep their own score for the same evaluator and row" */
    it("keeps the queue job separate too, so one job cannot drop the other", () => {
      const makeJobId = RecordEvaluatorResultCommand.makeJobId;
      if (!makeJobId) throw new Error("the command declares no job id");

      expect(makeJobId(verdict({ targetId: "target-eyMC-VVJ" }).data)).not.toBe(
        makeJobId(verdict({ targetId: "target-YyznMusS" }).data),
      );
    });
  });

  describe("when the same verdict is recorded twice", () => {
    /** @scenario "The same verdict sent twice is still stored once" */
    it("answers the same identity, so the retry collapses onto the original", () => {
      const once = identityOf(verdict({ targetId: "target-YyznMusS" }));
      const twice = identityOf(
        verdict({ targetId: "target-YyznMusS", passed: false }),
      );

      // Same target, same evaluator, same row: one fact, recorded twice.
      expect(once).toBe(twice);
    });
  });

  describe("when the verdicts differ by evaluator or by row", () => {
    /** @scenario "Two columns keep their own score for the same evaluator and row" */
    it("still separates them, so the target is an addition and not a swap", () => {
      const base = identityOf(verdict({ targetId: "target-A" }));
      const otherEvaluator = identityOf(
        verdict({ targetId: "target-A", evaluatorId: "category_l1_exact" }),
      );
      const otherRow = identityOf(verdict({ targetId: "target-A", index: 7 }));

      expect(new Set([base, otherEvaluator, otherRow]).size).toBe(3);
    });
  });
});

describe("given a recorded target output", () => {
  describe("when two columns produce an output for the same row", () => {
    /** @scenario "Two columns keep their own score for the same evaluator and row" */
    it("separates them by target, the way the verdicts now do", () => {
      const outputFor = (targetId: string): string =>
        identityOfEvent(
          new RecordTargetResultCommand().handle(output(targetId)),
        );

      expect(outputFor("target-eyMC-VVJ")).not.toBe(
        outputFor("target-YyznMusS"),
      );
    });
  });
});
