/**
 * What a caller reads back: the status published lowercase, the row cap as
 * `limit`, and the hydration plan not at all.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { describe, expect, it } from "vitest";

import { instantEvalJudgment, instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import {
  INSTANT_EVAL_STORED_STATUSES,
  isInstantEvalStoredStatus,
  publishedInstantEvalStatus,
} from "../instant-eval-run-status.rules.ts";
import { toInstantEvalJudgmentWire, toInstantEvalRunWire } from "../instant-eval-wire.rules.ts";

describe("given a stored run row", () => {
  describe("when it is put on the wire", () => {
    it("publishes the status lowercase and the cap as a limit", () => {
      const wire = toInstantEvalRunWire(instantEvalRunRow());

      expect(wire.status).toBe("running");
      expect(wire.limit).toBe(1_000);
      expect(wire.matchedByQuestion).toEqual({ annoyed: 12 });
      expect(wire.progress).toBe(40);
      expect(wire.tokens).toBe(4_200);
    });

    it("keeps the run's plan and its cost to us off the wire", () => {
      const wire = toInstantEvalRunWire(instantEvalRunRow());

      expect(wire).not.toHaveProperty("plan");
      expect(wire).not.toHaveProperty("costUsd");
      expect(wire).not.toHaveProperty("projectId");
    });

    it("writes every instant as a string, and an absent one as null", () => {
      const wire = toInstantEvalRunWire(instantEvalRunRow());

      expect(wire.createdAt).toBe("2026-09-18T10:00:00Z");
      expect(wire.startedAt).toBe("2026-09-18T10:00:00Z");
      expect(wire.finishedAt).toBeNull();
    });
  });

  describe("when the row's JSON columns carry something unreadable", () => {
    it("answers with empty rather than refusing the whole run", () => {
      const wire = toInstantEvalRunWire(
        instantEvalRunRow({
          parameters: { nested: { not: "a bound value" } },
          questions: [{ shape: "unknown" }],
        }),
      );

      expect(wire.parameters).toEqual({});
      expect(wire.questions).toEqual([]);
    });
  });
});

describe("given a stored judgement", () => {
  describe("when it is put on the wire", () => {
    it("carries the answer and writes an absent distribution as null", () => {
      const wire = toInstantEvalJudgmentWire(instantEvalJudgment());

      expect(wire).toMatchObject({
        traceId: "trace-1",
        questionId: "annoyed",
        status: "judged",
        passed: true,
        probability: 0.96,
        probabilities: null,
      });
    });
  });
});

describe("given a status read off a run row", () => {
  describe("when it is checked against the stored spelling", () => {
    it("publishes every stored status and refuses a spelling nothing wrote", () => {
      for (const stored of INSTANT_EVAL_STORED_STATUSES) {
        expect(publishedInstantEvalStatus(stored)).toBe(stored.toLowerCase());
        expect(isInstantEvalStoredStatus(stored)).toBe(true);
      }
      expect(isInstantEvalStoredStatus("running")).toBe(false);
      expect(isInstantEvalStoredStatus("PAUSED")).toBe(false);
    });
  });
});
