import type { AnalyticsService } from "@langwatch/analytics-contract";
import { createProcessMembers } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

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
import { MemoryAutomationEmailCapRepository } from "../../repositories/memory/memory.automation-email-cap.repository.ts";
import { PrismaCustomGraphRepository } from "../../repositories/prisma/prisma.custom-graph.repository.ts";
import { PrismaEmailSuppressionRepository } from "../../repositories/prisma/prisma.email-suppression.repository.ts";
import { PrismaGraphTriggerSentRepository } from "../../repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import { PrismaTriggerRepository } from "../../repositories/prisma/prisma.trigger.repository.ts";
import { PrismaWebhookDeliveryRepository } from "../../repositories/prisma/prisma.webhook-delivery.repository.ts";
import { AutomationEmailCapService } from "../../services/email-cap.service.ts";
import { AutomationGraphActivityService } from "../automation-graph-activity.service.ts";
import { AutomationGraphDeliveryService } from "../automation-graph-delivery.service.ts";
import {
  AutomationSlackSecretsService,
  AutomationSlackBotTokenDecryptorService,
  type AutomationSecretCrypto,
} from "../automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "../automation-webhook-secrets.service.ts";

/**
 * Spec: modules/automation/specs/graph-alert-worker-composition.feature
 */

/** Reversible and obviously not real, so a leak in a failure message is loud. */
const crypto = {
  encrypt: (plain: string) => `enc(${plain})`,
  decrypt: (cipher: string) => cipher.replace(/^enc\(/, "").replace(/\)$/, ""),
};

function slackTriggerRow() {
  return graphTriggerRow({
    action: "SEND_SLACK_MESSAGE",
    actionParams: {
      slackDelivery: "bot",
      slackBotToken: crypto.encrypt("xoxb-plain"),
      slackChannelId: "C0CHANNEL",
      threshold: 10,
      operator: "gt",
      timePeriod: 60,
      seriesName: "0",
    },
  });
}

function compose(
  seed: Parameters<typeof createGraphActivityPrismaDouble>[0],
  over: { delivery?: RecordingDelivery; crypto?: AutomationSecretCrypto } = {},
) {
  const secrets = over.crypto ?? crypto;
  const database = createGraphActivityPrismaDouble(seed);
  const clock = new FrozenClock();
  const delivery = over.delivery ?? new RecordingDelivery();
  const logger = new SilentLogger();
  const triggers = PrismaTriggerRepository.create(database.prisma, clock);
  const service = AutomationGraphActivityService.create({
    triggers,
    customGraphs: PrismaCustomGraphRepository.create(database.prisma),
    graphTriggerSent: PrismaGraphTriggerSentRepository.create(database.prisma),
    persistence: AutomationGraphDeliveryService.create({
      triggers,
      suppressions: PrismaEmailSuppressionRepository.create(database.prisma),
      webhookDeliveries: PrismaWebhookDeliveryRepository.create(database.prisma),
    }),
    clock,
    projects: new OneProject(),
    analytics: new BreachingAnalytics() as unknown as AnalyticsService,
    delivery,
    webhooks: AutomationWebhookSecretsService.create(secrets),
    slackTokens: AutomationSlackBotTokenDecryptorService.create(
      AutomationSlackSecretsService.create(secrets),
    ),
    emailCaps: AutomationEmailCapService.create({
      store: MemoryAutomationEmailCapRepository.create(),
      fallback: MemoryAutomationEmailCapRepository.create(),
    }),
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

    /** @scenario "A stored Slack credential is read back with the deployment's own key" */
    it("sends the Slack call with the plaintext token to the author's channel", async () => {
      const { adapter, delivery } = compose({ triggers: [slackTriggerRow()] });

      await adapter.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "real-time",
      });

      expect(delivery.slackBots.map(({ token, channel }) => ({ token, channel }))).toEqual([
        { token: "xoxb-plain", channel: "C0CHANNEL" },
      ]);
    });

    /** @scenario "A process holding no credentials key refuses rather than sending a ciphertext" */
    it("refuses as the unconfigured encryption member and sends nothing to Slack", async () => {
      const keyless = createProcessMembers({
        config: {
          processName: "graph-alert-keyless-test",
          encryptionKey: "",
          secrets: {},
          rateLimit: { requests: 60, seconds: 60 },
          mail: { provider: "off" },
        },
      }).read("encryption");
      const { adapter, delivery } = compose({ triggers: [slackTriggerRow()] }, { crypto: keyless });

      await expect(
        adapter.evaluateGraphTrigger({
          triggerId: "trigger-1",
          projectId: "project-1",
          reason: "real-time",
        }),
      ).rejects.toMatchObject({ name: "MemberNotConfiguredError", member: "encryption" });
      expect(delivery.slackBots).toEqual([]);
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
