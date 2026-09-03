import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { GraphTriggerEvaluationResult, TriggerSummary } from "@langwatch/automation-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";
import { PostgresAutomationGraphActivityAdapter } from "../../adapters/postgres.automation-graph-activity.adapter";
import {
  BreachingAnalytics,
  createGraphActivityPrismaDouble,
  FrozenClock,
  graphTriggerRow,
  OneProject,
  RecordingDelivery,
  SilentLogger,
  TestDispatchErrors,
} from "../../fixtures/graph-activity.fixture";
import { AutomationEmailCapService } from "../../services/email-cap.service";
import { AutomationGraphActivityPort } from "../../ports/automation-graph-activity.port";
import { createGraphTriggerActivityHandler } from "../graph-trigger-activity.subscriber";

/**
 * Spec: packages/features/automation/specs/graph-alert-worker-composition.feature
 */

const context = { tenantId: "project-1" } as never;
const event = { occurredAt: Date.now() } as never;

class ScriptedActivity extends AutomationGraphActivityPort {
  readonly evaluated: string[] = [];

  constructor(
    private readonly triggerIds: string[],
    private readonly failing: string,
  ) {
    super();
  }

  async getActiveGraphTriggersForProject(): Promise<TriggerSummary[]> {
    return this.triggerIds.map((id) => ({ id }) as TriggerSummary);
  }

  async evaluateGraphTrigger(input: { triggerId: string }): Promise<GraphTriggerEvaluationResult> {
    this.evaluated.push(input.triggerId);
    if (input.triggerId === this.failing) {
      throw new Error("analytics unavailable");
    }

    return { status: "not_breached" } as GraphTriggerEvaluationResult;
  }
}

describe("createGraphTriggerActivityHandler", () => {
  describe("given a project with several graph automations", () => {
    describe("when evaluating one of them fails", () => {
      /** @scenario "One trigger's failure does not starve the rest" */
      it("evaluates every other automation and then reports the failure", async () => {
        const activity = new ScriptedActivity(["a", "b", "c"], "b");

        await expect(createGraphTriggerActivityHandler(activity)(event, context)).rejects.toThrow(
          /1\/3 evaluations failed/,
        );
        expect(activity.evaluated).toEqual(["a", "b", "c"]);
      });
    });
  });

  describe("given the vertical a background process composes", () => {
    /** @scenario "The two questions the real-time path asks are the whole port" */
    it("is accepted by the handler with nothing else supplied", async () => {
      const database = createGraphActivityPrismaDouble({ triggers: [graphTriggerRow()] });
      const delivery = new RecordingDelivery();
      const handler = createGraphTriggerActivityHandler(
        PostgresAutomationGraphActivityAdapter.create({
          prisma: database.prisma as never,
          clock: new FrozenClock(),
          projects: new OneProject() as unknown as ProjectService,
          analytics: new BreachingAnalytics() as unknown as AnalyticsService,
          delivery,
          crypto: { encrypt: (value) => value, decrypt: (value) => value },
          emailCaps: AutomationEmailCapService.create({ store: null }),
          logger: new SilentLogger(),
          dispatchErrors: new TestDispatchErrors(),
          baseHost: "https://app.langwatch.test",
          emailHourlyCap: 100,
          tenantDailyCap: 10_000,
        }),
      );

      await handler(event, context);

      expect(delivery.emails.map((email) => email.recipients)).toEqual([["ada@example.com"]]);
    });
  });
});
