import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import type * as observabilityModule from "@langwatch/observability";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Spec: modules/automation/specs/graph-alert-worker-composition.feature
 */

const testLog = createTestLogger();
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => testLog.logger,
}));

// After the mock: the sweep and the fixtures build their loggers when their modules load.
const { InertIntentRetention, InertScheduledIntents } =
  await import("../../__tests__/fixtures/pipeline-test-harness.ts");
const { webhookReceiverRefusal } =
  await import("../../__tests__/fixtures/webhook-receiver.fixture.ts");
const { runGraphAlertSweep } = await import("../graph-alert-sweep.intent.ts");

const RECEIVER_REFUSED = "refused by the automation's own webhook receiver";

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
  afterEach(() => {
    testLog.lines.length = 0;
  });

  describe("given a candidate whose own webhook receiver answers 404", () => {
    /** @scenario "The scheduled sweep does not redeliver a terminal webhook receiver refusal" */
    it("warns with its status, never its body, and does not retry the sweep", async () => {
      const candidates = new FailingCandidates({
        a: webhookReceiverRefusal({ status: 404, retryable: false }),
      });

      await expect(sweep(candidates)).resolves.toBeUndefined();
      expect(testLog.lines.findLine("warn", RECEIVER_REFUSED)).toMatchObject({
        projectId: "project-1",
        triggerId: "a",
        status: 404,
        retryable: false,
      });
      expect(JSON.stringify(testLog.lines)).not.toContain("Token not found");
    });
  });

  describe("given candidates failing at a 503 receiver and inside LangWatch", () => {
    /** @scenario "The scheduled sweep redelivers only failures a retry can help" */
    it("evaluates both and retries the sweep for both", async () => {
      const candidates = new FailingCandidates({
        a: webhookReceiverRefusal({ status: 503, retryable: true }),
        b: new Error("analytics unavailable"),
      });

      await expect(sweep(candidates)).rejects.toThrow(/failed for 2\/2 candidates/);
      expect(candidates.evaluated).toEqual(["a", "b"]);
    });
  });
});
