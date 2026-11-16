import type { GraphTriggerEvaluationResult, TriggerSummary } from "@langwatch/automation-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { webhookReceiverRefusal } from "../../__tests__/fixtures/webhook-receiver.fixture.ts";
import type { AutomationGraphActivity } from "../../features/graph-alert/services/automation-graph-activity.service.ts";
import { createGraphTriggerActivityHandler } from "../graph-trigger-activity.subscriber.ts";

/**
 * Spec: modules/automation/specs/graph-alert-worker-composition.feature
 */

const logged = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: logged.warn, error: logged.error }),
}));

const context = { tenantId: "project-1" } as never;
const event = { occurredAt: Date.now() } as never;
const analyticsDown = new Error("analytics unavailable");

/** Evaluates each trigger in order, throwing the failure scripted for it (null passes). */
class ScriptedActivity implements AutomationGraphActivity {
  readonly evaluated: string[] = [];

  constructor(private readonly failures: Record<string, Error | null>) {}

  async getActiveGraphTriggersForProject(): Promise<TriggerSummary[]> {
    return Object.keys(this.failures).map((id) => ({ id }) as TriggerSummary);
  }

  async evaluateGraphTrigger(input: { triggerId: string }): Promise<GraphTriggerEvaluationResult> {
    this.evaluated.push(input.triggerId);
    const failure = this.failures[input.triggerId];
    if (failure) {
      throw failure;
    }

    return { status: "not_breached" } as GraphTriggerEvaluationResult;
  }
}

function run(activity: ScriptedActivity): Promise<void> {
  return createGraphTriggerActivityHandler(activity)(event, context);
}

describe("createGraphTriggerActivityHandler", () => {
  afterEach(() => vi.clearAllMocks());

  describe("given a graph automation whose own webhook receiver answers 404", () => {
    /** @scenario "A webhook receiver's terminal refusal is the customer's, not ours" */
    it("warns with its status, never its body, and asks for no redelivery", async () => {
      const activity = new ScriptedActivity({
        a: webhookReceiverRefusal({ status: 404, retryable: false }),
      });

      await expect(run(activity)).resolves.toBeUndefined();
      expect(logged.warn).toHaveBeenCalledWith(
        { projectId: "project-1", triggerId: "a", status: 404, retryable: false },
        expect.any(String),
      );
      expect(logged.error).not.toHaveBeenCalled();
    });
  });

  describe("given a graph automation whose own webhook receiver answers 503", () => {
    /** @scenario "A webhook receiver that may yet answer is warned about and redelivered" */
    it("warns with its status and asks for redelivery", async () => {
      const activity = new ScriptedActivity({
        a: webhookReceiverRefusal({ status: 503, retryable: true }),
      });

      await expect(run(activity)).rejects.toThrow(/1\/1 evaluations failed/);
      expect(logged.warn).toHaveBeenCalledWith(
        { projectId: "project-1", triggerId: "a", status: 503, retryable: true },
        expect.any(String),
      );
      expect(logged.error).not.toHaveBeenCalled();
    });
  });

  describe("given a graph automation our own evaluation fails", () => {
    /** @scenario "Our own evaluation failure is an error and is redelivered" */
    it("logs an error and asks for redelivery", async () => {
      const activity = new ScriptedActivity({ a: analyticsDown });

      await expect(run(activity)).rejects.toThrow(/1\/1 evaluations failed/);
      expect(logged.error).toHaveBeenCalledWith(
        { projectId: "project-1", triggerId: "a", error: "analytics unavailable" },
        "graphTriggerActivity: evaluation failed",
      );
      expect(logged.warn).not.toHaveBeenCalled();
    });
  });

  describe("given receivers and our own evaluation failing together", () => {
    /** @scenario "Only failures a retry can help are redelivered" */
    it("evaluates every automation and counts only what a redelivery can help", async () => {
      const activity = new ScriptedActivity({
        a: webhookReceiverRefusal({ status: 404, retryable: false }),
        b: analyticsDown,
        c: null,
        d: webhookReceiverRefusal({ status: 503, retryable: true }),
      });

      await expect(run(activity)).rejects.toThrow(/2\/4 evaluations failed/);
      expect(activity.evaluated).toEqual(["a", "b", "c", "d"]);
    });
  });
});
