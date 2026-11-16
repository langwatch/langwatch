import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  InertIntentRetention,
  InertScheduledIntents,
} from "../../__tests__/fixtures/pipeline-test-harness.ts";
import { webhookReceiverRefusal } from "../../__tests__/fixtures/webhook-receiver.fixture.ts";
import { runGraphAlertSweep } from "../graph-alert-sweep.intent.ts";

/** Hands out one candidate per scripted failure and throws it when evaluated. */
class FailingCandidates extends InertScheduledIntents {
  readonly evaluated: string[] = [];

  constructor(private readonly failures: Record<string, Error>) {
    super();
  }

  override async decideGraphTriggerHeartbeat(): Promise<GraphTriggerSweepCandidate[]> {
    return Object.keys(this.failures).map((triggerId) => ({
      triggerId,
      projectId: "project-1",
      reason: "heartbeat-absence",
    }));
  }

  override async evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    this.evaluated.push(input.triggerId);
    const failure = this.failures[input.triggerId];
    if (failure) {
      throw failure;
    }

    return super.evaluateGraphTrigger(input);
  }
}

function sweep(candidates: FailingCandidates): Promise<void> {
  return runGraphAlertSweep(candidates, new InertIntentRetention())({ scheduledFor: 10_000 });
}

describe("runGraphAlertSweep", () => {
  describe("given a candidate whose own webhook receiver answers 404", () => {
    it("does not retry the sweep for it", async () => {
      const candidates = new FailingCandidates({
        a: webhookReceiverRefusal({ status: 404, retryable: false }),
      });

      await expect(sweep(candidates)).resolves.toBeUndefined();
      expect(candidates.evaluated).toEqual(["a"]);
    });
  });

  describe("given candidates failing at a 503 receiver and inside LangWatch", () => {
    it("retries the sweep for both", async () => {
      const candidates = new FailingCandidates({
        a: webhookReceiverRefusal({ status: 503, retryable: true }),
        b: new Error("analytics unavailable"),
      });

      await expect(sweep(candidates)).rejects.toThrow(/failed for 2\/2 candidates/);
    });
  });
});
