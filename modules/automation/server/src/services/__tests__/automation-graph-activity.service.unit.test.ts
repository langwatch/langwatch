import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";
import { AutomationEmailCapService } from "../../services/email-cap.service.ts";
import {
  AutomationSlackSecretsService,
  AutomationSlackBotTokenDecryptorService,
} from "../automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "../automation-webhook-secrets.service.ts";
import { PrismaCustomGraphRepository } from "../../repositories/prisma/prisma.custom-graph.repository.ts";
import { PrismaEmailSuppressionRepository } from "../../repositories/prisma/prisma.email-suppression.repository.ts";
import { PrismaGraphTriggerSentRepository } from "../../repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "../../repositories/prisma/prisma.trigger.repository.ts";
import { PrismaWebhookDeliveryRepository } from "../../repositories/prisma/prisma.webhook-delivery.repository.ts";
import { AutomationGraphDeliveryService } from "../automation-graph-delivery.service.ts";
import { AutomationGraphActivityService } from "../automation-graph-activity.service.ts";
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

/**
 * Spec: modules/automation/specs/graph-alert-worker-composition.feature
 */

/** Reversible and obviously not real, so a leak in a failure message is loud. */
const crypto = {
  encrypt: (plain: string) => `enc(${plain})`,
  decrypt: (cipher: string) => cipher.replace(/^enc\(/, "").replace(/\)$/, ""),
};

function compose(
  seed: Parameters<typeof createGraphActivityPrismaDouble>[0],
  over: { delivery?: RecordingDelivery } = {},
) {
  const database = createGraphActivityPrismaDouble(seed);
  const clock = new FrozenClock();
  const delivery = over.delivery ?? new RecordingDelivery();
  const logger = new SilentLogger();
  const triggers = PrismaTriggerRepository.create(database.prisma as unknown as TriggerDatabase, clock);
  const service = AutomationGraphActivityService.create({
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
    logger,
    dispatchErrors: new TestDispatchErrors(),
    baseHost: "https://app.langwatch.test",
    emailHourlyCap: 100,
    tenantDailyCap: 10_000,
  });

  return { adapter: service, database, delivery, logger };
}

describe("AutomationGraphActivityService", () => {
  describe("given a composed graph-alert vertical", () => {
    /** @scenario "The two questions the real-time path asks are the whole port" */
    it("reports only the automations that watch a custom graph", async () => {
      const { adapter } = compose({
        triggers: [
          graphTriggerRow(),
          graphTriggerRow({ id: "trace-trigger", customGraphId: null }),
          graphTriggerRow({ id: "report-trigger", triggerKind: "REPORT" }),
          graphTriggerRow({ id: "inactive-trigger", active: false }),
        ],
      });

      expect(
        (await adapter.getActiveGraphTriggersForProject("project-1")).map((trigger) => trigger.id),
      ).toEqual(["trigger-1"]);
    });

    /** @scenario "One read serves both halves of a trace's arrival" */
    it("reads the project's automations once inside the window", async () => {
      const { adapter, database } = compose({ triggers: [graphTriggerRow()] });

      await adapter.getActiveGraphTriggersForProject("project-1");
      await adapter.getActiveGraphTriggersForProject("project-1");

      expect(database.reads.triggerFindMany).toBe(1);
    });

    /** @scenario "The vertical composes from a database and transports alone" */
    it("composes without reading an environment", () => {
      expect(() => compose({ triggers: [] })).not.toThrow();
    });
  });

  describe("given a composed graph-alert vertical whose automation has crossed its threshold", () => {
    /** @scenario "A firing automation reaches the channel its author chose" */
    it("delivers to the author's channel and records the recipient", async () => {
      const { adapter, delivery } = compose({ triggers: [graphTriggerRow()] });

      const result = await adapter.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "real-time",
      });

      expect(result.status).toBe("fired");
      expect(delivery.emails.map((email) => email.recipients)).toEqual([["ada@example.com"]]);
      expect(delivery.slackWebhooks).toHaveLength(0);
      expect(delivery.webhooks).toHaveLength(0);
    });

    /** @scenario "A firing automation reaches the channel its author chose" */
    it("does not send twice while the same incident stays open", async () => {
      const { adapter, delivery } = compose({ triggers: [graphTriggerRow()] });

      await adapter.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "real-time",
      });
      const second = await adapter.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "real-time",
      });

      expect(second.status).toBe("already_firing");
      expect(delivery.emails).toHaveLength(1);
    });

    /** @scenario "A suppressed recipient is not written to" */
    it("sends nothing when the only recipient has unsubscribed", async () => {
      const { adapter, delivery } = compose({
        triggers: [graphTriggerRow()],
        suppressions: [
          { projectId: "project-1", triggerId: "trigger-1", email: "ada@example.com" },
        ],
      });

      await adapter.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "real-time",
      });

      expect(delivery.emails).toHaveLength(0);
    });
  });
});
