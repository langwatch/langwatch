import { openStores, PipelineParticipation } from "@langwatch/process-stores";
import { storesOwner, type StoresConfig } from "@langwatch/process-stores/config";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { frozenAt } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import {
  breachingAnalytics,
  createGraphActivityPrismaDouble,
  FROZEN_NOW,
  graphTriggerRow,
  OneProject,
  RecordingDelivery,
  SilentLogger,
  TestDispatchErrors,
} from "../../__tests__/fixtures/graph-activity.fixture.ts";
import { MemoryAutomationEmailCapRepository } from "../../repositories/memory/memory.automation-email-cap.repository.ts";
import { PrismaCustomGraphRepository } from "../../repositories/prisma/prisma.custom-graph.repository.ts";
import { PrismaEmailSuppressionRepository } from "../../repositories/prisma/prisma.email-suppression.repository.ts";
import { PrismaGraphTriggerSentRepository } from "../../repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import { PrismaTriggerRepository } from "../../repositories/prisma/prisma.trigger.repository.ts";
import type { TriggerSecretCipher } from "../../repositories/trigger.repository.ts";
import { AutomationEmailCapService } from "../../services/email-cap.service.ts";
import { AutomationGraphActivityService } from "../automation-graph-activity.service.ts";
import { AutomationGraphDeliveryService } from "../automation-graph-delivery.service.ts";
import { AutomationWebhookSecretsService } from "../automation-webhook-secrets.service.ts";
import { SlackDestinationService } from "../slack-destination.service.ts";

/**
 * Spec: modules/automation/specs/graph-alert-worker-composition.feature
 */

const storesConfig: StoresConfig = {
  defaultRetentionDays: 30,
  shutdownDrainTimeoutMs: undefined,
  clickhousePool: {
    override: undefined,
    replicas: undefined,
    serverMaxConcurrentQueries: undefined,
    serverNodes: undefined,
    clientsPerProcess: undefined,
  },
  rateLimit: { requests: 60, seconds: 60 },
  redis: { dbIndex: undefined },
  objectStorage: {
    backend: "file",
    localRoot: "/tmp/langwatch-keyless-test",
    s3: { bucket: undefined, endpoint: undefined, region: undefined },
    azure: {
      authMode: undefined,
      accountName: undefined,
      container: undefined,
      endpoint: undefined,
      authorityHost: undefined,
      tokenAudience: undefined,
      allowInsecureTokenEndpointForTests: undefined,
      identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
    },
  },
};

/** The cipher a process with no key hands the live trigger repository. */
async function keylessEncryption(name: string) {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }).withEnv());
  const { members } = await openStores({
    name,
    config: storesConfig,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production: false,
  });
  return members.read("encryption");
}

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
  over: { delivery?: RecordingDelivery; crypto?: TriggerSecretCipher } = {},
) {
  const secrets = over.crypto ?? crypto;
  const database = createGraphActivityPrismaDouble(seed);
  const clock = frozenAt(FROZEN_NOW);
  const delivery = over.delivery ?? new RecordingDelivery();
  const logger = new SilentLogger();
  const triggers = PrismaTriggerRepository.create(database.prisma, clock, secrets);
  const service = AutomationGraphActivityService.create({
    triggers,
    customGraphs: PrismaCustomGraphRepository.create(database.prisma),
    graphTriggerSent: PrismaGraphTriggerSentRepository.create(database.prisma),
    persistence: AutomationGraphDeliveryService.create({
      triggers,
      suppressions: PrismaEmailSuppressionRepository.create(database.prisma),
    }),
    clock,
    projects: new OneProject(),
    analytics: breachingAnalytics(),
    delivery,
    webhooks: AutomationWebhookSecretsService.create(triggers),
    slackDestinations: SlackDestinationService.create({
      slack: { findUsableSlackSecret: async () => [] },
      triggers,
    }),
    emailCaps: AutomationEmailCapService.create({
      store: MemoryAutomationEmailCapRepository.create(),
      fallback: MemoryAutomationEmailCapRepository.create(),
    }),
    logger,
    dispatchErrors: new TestDispatchErrors(),
    latestEvaluations: { record: async () => undefined },
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
    it("refuses naming the missing encryption key and sends nothing to Slack", async () => {
      const keyless = await keylessEncryption("graph-alert-keyless-test");
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
