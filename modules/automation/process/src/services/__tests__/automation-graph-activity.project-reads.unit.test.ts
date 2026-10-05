/** @see specs/trace-processing/worker-record-span-capability-services.feature */
import type { AnalyticsService } from "@langwatch/analytics-contract";
import { frozenAt } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import {
  breachingAnalytics,
  createGraphActivityPrismaDouble,
  FROZEN_NOW,
  graphTriggerRow,
  RecordingDelivery,
  SilentLogger,
  TestDispatchErrors,
} from "../../__tests__/fixtures/graph-activity.fixture.ts";
import { MemoryAutomationEmailCapRepository } from "../../repositories/memory/memory.automation-email-cap.repository.ts";
import { PrismaCustomGraphRepository } from "../../repositories/prisma/prisma.custom-graph.repository.ts";
import { PrismaEmailSuppressionRepository } from "../../repositories/prisma/prisma.email-suppression.repository.ts";
import { PrismaGraphTriggerSentRepository } from "../../repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import { PrismaTriggerLatestEvaluationRepository } from "../../repositories/prisma/prisma.trigger-latest-evaluation.repository.ts";
import { PrismaTriggerRepository } from "../../repositories/prisma/prisma.trigger.repository.ts";
import { AutomationGraphActivityService } from "../automation-graph-activity.service.ts";
import { AutomationGraphDeliveryService } from "../automation-graph-delivery.service.ts";
import { AutomationWebhookSecretsService } from "../automation-webhook-secrets.service.ts";
import type { AutomationProjectDirectory } from "../automation.service.ts";
import { AutomationEmailCapService } from "../email-cap.service.ts";
import { SlackDestinationService } from "../slack-destination.service.ts";
import { TriggerLatestEvaluationService } from "../trigger-latest-evaluation.service.ts";

const crypto = { encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };

function composeOver(input: { projects: AutomationProjectDirectory; analytics: AnalyticsService }) {
  const database = createGraphActivityPrismaDouble({ triggers: [graphTriggerRow()] });
  const delivery = new RecordingDelivery();
  const clock = frozenAt(FROZEN_NOW);
  const logger = new SilentLogger();
  const vertical = AutomationGraphActivityService.create({
    triggers: PrismaTriggerRepository.create(database.prisma, clock),
    customGraphs: PrismaCustomGraphRepository.create(database.prisma),
    graphTriggerSent: PrismaGraphTriggerSentRepository.create(database.prisma),
    persistence: AutomationGraphDeliveryService.create({
      triggers: PrismaTriggerRepository.create(database.prisma, clock),
      suppressions: PrismaEmailSuppressionRepository.create(database.prisma),
    }),
    clock,
    projects: input.projects,
    analytics: input.analytics,
    delivery,
    webhooks: AutomationWebhookSecretsService.create(crypto),
    slackDestinations: SlackDestinationService.create({
      slack: { findUsableSlackSecret: async () => [] },
      crypto,
    }),
    emailCaps: AutomationEmailCapService.create({
      store: MemoryAutomationEmailCapRepository.create(),
      fallback: MemoryAutomationEmailCapRepository.create(),
    }),
    logger,
    dispatchErrors: new TestDispatchErrors(),
    latestEvaluations: TriggerLatestEvaluationService.create({
      repository: PrismaTriggerLatestEvaluationRepository.create(database.prisma),
      logger,
    }),
    baseHost: "https://app.langwatch.test",
    emailHourlyCap: 100,
    tenantDailyCap: 10_000,
  });

  return { vertical, delivery };
}

describe("AutomationGraphActivityService", () => {
  describe("given the project reads the process composed", () => {
    describe("when the graph-alert vertical is composed over them", () => {
      /** @scenario "The graph vertical takes the project reads this process composes" */
      it("is built from the project directory and the analytics reads alone", async () => {
        const asked: string[] = [];
        const { vertical, delivery } = composeOver({
          projects: {
            findById: async (projectId) => {
              asked.push(projectId);
              return { id: projectId, name: "Acme", slug: "acme" };
            },
          },
          analytics: breachingAnalytics(),
        });

        const result = await vertical.evaluateGraphTrigger({
          triggerId: "trigger-1",
          projectId: "project-1",
          reason: "real-time",
        });

        expect(result.status).toBe("fired");
        expect(asked).toEqual(["project-1"]);
        expect(delivery.emails).toHaveLength(1);
      });
    });
  });
});
