import type { AnalyticsService } from "@langwatch/analytics-contract";
import {
  BreachingAnalytics,
  createGraphActivityPrismaDouble,
  graphTriggerRow,
  OneProject,
} from "@langwatch/automation-server/testing";
import type { SlackApiTransport } from "@langwatch/automation-server";
import { EmailDeliveryPort, type EmailContent } from "@langwatch/notification-server";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import { tryCreateWorkerAutomationGraphComposition } from "../worker-automation-graph.composition";

/**
 * Spec: packages/features/automation/specs/graph-alert-worker-composition.feature
 *
 * This is a COMPOSITION-CAPABILITY test, not a mounted pipeline. Trace's
 * real-time subscriber is still registered by the application, so nothing in
 * this process asks the vertical anything yet; what has to be true today is
 * that this composition root can build it from its own configuration and the
 * two capability services it is handed, and that an alert leaving it goes out
 * through the mail gateway this process owns.
 */

const ENVIRONMENT = {
  BASE_HOST: "https://app.langwatch.test",
  NEXTAUTH_SECRET: "0f".repeat(32),
  EMAIL_DEFAULT_FROM: "LangWatch <contact@langwatch.ai>",
};

class RecordingMailer extends EmailDeliveryPort {
  readonly sent: EmailContent[] = [];

  defaultFrom(): string {
    return "LangWatch <contact@langwatch.ai>";
  }

  async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return {};
  }
}

/** Records the Slack Web API call without making one. */
class RecordingSlackApi implements SlackApiTransport {
  readonly requests: Array<{ authorization: string; body: string }> = [];

  async request(input: {
    headers: Record<string, string>;
    body: string;
  }): Promise<{ status: number; body: string }> {
    this.requests.push({ authorization: input.headers.Authorization ?? "", body: input.body });

    return { status: 200, body: JSON.stringify({ ok: true }) };
  }
}

function composeGraph(
  environment: Record<string, unknown> = ENVIRONMENT,
  seed = { triggers: [graphTriggerRow()] },
) {
  const config = resolveWorkerConfig(environment);
  const database = createGraphActivityPrismaDouble(seed);
  const mailer = new RecordingMailer();
  const slackApi = new RecordingSlackApi();
  const graph = tryCreateWorkerAutomationGraphComposition({
    config,
    prisma: database.prisma as never,
    mail: { delivery: mailer, baseHost: config.mail?.baseHost ?? "" },
    dependencies: {
      projects: new OneProject() as unknown as ProjectService,
      analytics: new BreachingAnalytics() as unknown as AnalyticsService,
    },
    slackApiTransport: slackApi,
  });

  return { config, graph, mailer, slackApi, database };
}

const STORED_CREDENTIALS_KEY = "ab".repeat(32);

/** A Slack-bot automation whose token was written under the deployment's key. */
function slackBotTriggerRow(key: string) {
  return graphTriggerRow({
    action: "SEND_SLACK_MESSAGE",
    actionParams: {
      threshold: 10,
      operator: "gt",
      timePeriod: 60,
      seriesName: "0",
      slackDelivery: "bot",
      slackChannelId: "C0123ABCD",
      slackBotToken: AesGcmSecretEncryptionAdapter.create({ key }).encrypt("xoxb-real-token"),
    },
  });
}

describe("tryCreateWorkerAutomationGraphComposition", () => {
  describe("given a deployment that named its own host", () => {
    /** @scenario "The vertical composes from a database and transports alone" */
    it("builds the graph-alert vertical this process can answer with", () => {
      const { graph } = composeGraph();

      expect(graph).toBeDefined();
    });

    /** @scenario "The two questions the real-time path asks are the whole port" */
    it("answers the two questions the real-time path asks", async () => {
      const { graph } = composeGraph({
        ...ENVIRONMENT,
        TRIGGER_EMAIL_HOURLY_CAP: "5",
      });

      expect(
        (await graph!.getActiveGraphTriggersForProject("project-1")).map((trigger) => trigger.id),
      ).toEqual(["trigger-1"]);
    });

    /** @scenario "A firing automation reaches the channel its author chose" */
    it("sends a firing alert through this process's own mail gateway", async () => {
      const { graph, mailer } = composeGraph();

      const result = await graph!.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "real-time",
      });

      expect(result.status).toBe("fired");
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.bcc).toEqual(["ada@example.com"]);
      // The footer links back to the deployment this process was configured
      // for — the one thing an absent BASE_HOST would have silently broken.
      expect(mailer.sent[0]?.html).toContain("https://app.langwatch.test/unsubscribe?token=");
    });
  });

  describe("given an automation whose Slack token this deployment encrypted", () => {
    /** @scenario "A stored Slack credential is read back with the deployment's own key" */
    it("reads the token back with the deployment's own key", async () => {
      const { graph, slackApi } = composeGraph(
        { ...ENVIRONMENT, CREDENTIALS_SECRET: STORED_CREDENTIALS_KEY },
        { triggers: [slackBotTriggerRow(STORED_CREDENTIALS_KEY)] },
      );

      await graph!.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "real-time",
      });

      expect(slackApi.requests).toHaveLength(1);
      expect(slackApi.requests[0]?.authorization).toBe("Bearer xoxb-real-token");
      expect(JSON.parse(slackApi.requests[0]!.body) as { channel: string }).toMatchObject({
        channel: "C0123ABCD",
      });
    });

    /** @scenario "A process holding no credentials key refuses rather than sending a ciphertext" */
    it("refuses by name when this process holds no key at all", async () => {
      const { graph, slackApi } = composeGraph(
        { BASE_HOST: ENVIRONMENT.BASE_HOST, EMAIL_DEFAULT_FROM: ENVIRONMENT.EMAIL_DEFAULT_FROM },
        { triggers: [slackBotTriggerRow(STORED_CREDENTIALS_KEY)] },
      );

      await expect(
        graph!.evaluateGraphTrigger({
          triggerId: "trigger-1",
          projectId: "project-1",
          reason: "real-time",
        }),
      ).rejects.toThrow(/no automation credentials key/);
      expect(slackApi.requests).toHaveLength(0);
    });
  });

  describe("given a deployment that named no host", () => {
    /** @scenario "The vertical composes from a database and transports alone" */
    it("reports that this process has no graph-alert capability", () => {
      const { graph } = composeGraph({ NEXTAUTH_SECRET: "0f".repeat(32) });

      expect(graph).toBeUndefined();
    });
  });
});

describe("resolveWorkerConfig automation leaves", () => {
  describe("given the application's own variables", () => {
    /** @scenario "The vertical composes from a database and transports alone" */
    it("reads the two email ceilings and the credentials key the application reads", () => {
      const config = resolveWorkerConfig({
        ...ENVIRONMENT,
        TRIGGER_EMAIL_HOURLY_CAP: "7",
        TRIGGER_EMAIL_TENANT_DAILY_CAP: "70",
        CREDENTIALS_SECRET: "ab".repeat(32),
      });

      expect(config.automation).toEqual({
        emailHourlyCap: 7,
        tenantDailyCap: 70,
        credentialsEncryptionKey: "ab".repeat(32),
      });
      expect(config.mail?.unsubscribeSigningSecret).toBe("0f".repeat(32));
    });

    /** @scenario "The vertical composes from a database and transports alone" */
    it("falls back to the older credentials variable, and to the application's defaults", () => {
      const config = resolveWorkerConfig(ENVIRONMENT);

      expect(config.automation).toEqual({
        emailHourlyCap: 100,
        tenantDailyCap: 10000,
        credentialsEncryptionKey: "0f".repeat(32),
      });
    });
  });
});
