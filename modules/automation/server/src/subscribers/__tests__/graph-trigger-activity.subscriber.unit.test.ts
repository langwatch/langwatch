import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { GraphTriggerEvaluationResult, TriggerSummary } from "@langwatch/automation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";
import {
  AutomationSlackSecretsService,
  AutomationSlackBotTokenDecryptorService,
} from "../../services/automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "../../services/automation-webhook-secrets.service.ts";
import {
  BreachingAnalytics,
  createGraphActivityPrismaDouble,
  FrozenClock,
  graphTriggerRow,
  OneProject,
  RecordingDelivery,
  SilentLogger,
  TestDispatchErrors,
} from "../../fixtures/graph-activity.fixture.ts";
import { AutomationEmailCapService } from "../../services/email-cap.service.ts";
import { AutomationGraphDeliveryService } from "../../services/automation-graph-delivery.service.ts";
import { AutomationGraphActivityService } from "../../services/automation-graph-activity.service.ts";
import { AutomationGraphActivity } from "../../app/automation.members.ts";
import { PrismaCustomGraphRepository } from "../../repositories/prisma/prisma.custom-graph.repository.ts";
import { PrismaEmailSuppressionRepository } from "../../repositories/prisma/prisma.email-suppression.repository.ts";
import { PrismaGraphTriggerSentRepository } from "../../repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "../../repositories/prisma/prisma.trigger.repository.ts";
import { PrismaWebhookDeliveryRepository } from "../../repositories/prisma/prisma.webhook-delivery.repository.ts";
import { createGraphTriggerActivityHandler } from "../graph-trigger-activity.subscriber.ts";

/**
 * Spec: modules/automation/specs/graph-alert-worker-composition.feature
 */

const context = { tenantId: "project-1" } as never;
const event = { occurredAt: Date.now() } as never;

class ScriptedActivity implements AutomationGraphActivity {
  readonly evaluated: string[] = [];

  constructor(
    private readonly triggerIds: string[],
    private readonly failing: string,
  ) {
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
      const clock = new FrozenClock();
      const delivery = new RecordingDelivery();
      const crypto = { encrypt: (value: string) => value, decrypt: (value: string) => value };
      const triggers = PrismaTriggerRepository.create(
        database.prisma as unknown as TriggerDatabase,
        clock,
      );
      const handler = createGraphTriggerActivityHandler(
        AutomationGraphActivityService.create({
          triggers,
          customGraphs: PrismaCustomGraphRepository.create(database.prisma as never),
          graphTriggerSent: PrismaGraphTriggerSentRepository.create(database.prisma as never),
          persistence: AutomationGraphDeliveryService.create({
            triggers,
            suppressions: PrismaEmailSuppressionRepository.create(database.prisma as never),
            webhookDeliveries: PrismaWebhookDeliveryRepository.create(database.prisma as never),
          }),
          clock,
          projects: new OneProject() as unknown as ProjectApi,
          analytics: new BreachingAnalytics() as unknown as AnalyticsService,
          delivery,
          webhooks: AutomationWebhookSecretsService.create(crypto),
          slackTokens: new AutomationSlackBotTokenDecryptorService(AutomationSlackSecretsService.create(crypto)),
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
