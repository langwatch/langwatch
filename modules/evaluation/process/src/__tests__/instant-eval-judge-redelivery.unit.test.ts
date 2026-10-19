/**
 * A monitor command delivered again after its judge call succeeded is billed once: both
 * deliveries carry the command's own retry key (ADR-174 decision 9). The leaf turns one key into
 * one request id, and gateway writes one ledger row per request id; each has its own test.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { randomUUID } from "node:crypto";

import type { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { buildExecuteCommand } from "./support/evaluation-execution.fixtures.ts";
import { buildInstantEvalMonitor } from "./support/instant-eval-monitor.fixtures.ts";

describe("Instant Evals judge on a redelivered monitor command", () => {
  describe("given an evaluation command whose judge call succeeded", () => {
    describe("when recording its outcome failed once and the command is delivered again", () => {
      /** @scenario "A redelivered evaluation is billed once" */
      it("leaves one spend row for it", async () => {
        // The ledger keeps one row per request id; a keyed call's id is its retry key.
        const ledger = new Map<string, number>();
        const judge: InstantEvalJudgeApi["judge"] = async ({ requestKey }) => {
          ledger.set(requestKey ?? randomUUID(), 0.0004);
          return {
            outcome: "judged",
            judgement: {
              verdicts: [{ questionId: "judge", probability: 0.9 }],
              inputTokens: 500,
              isTextTruncated: false,
            },
            priceUsd: 0.0004,
          };
        };
        const { handler, calls, costRecorder } = buildInstantEvalMonitor({ judge });
        const command = buildExecuteCommand({
          evaluationId: "eval-redelivered",
          evaluatorType: "langevals/llm_boolean",
        });

        // The first delivery's events are never stored, so the command comes again.
        await handler.handle(command);
        await handler.handle(command);

        expect(calls).toHaveLength(2);
        expect(new Set(calls.map((call) => call.requestKey))).toEqual(
          new Set(["project-evaluation-test:eval-redelivered:execution"]),
        );
        expect(ledger.size).toBe(1);
        expect(costRecorder.created).toHaveBeenCalledTimes(1);
      });
    });
  });
});
