import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import { env } from "../../../src/env.mjs";
import { sendUsageLimitEmail } from "../../../src/server/mailer/usageLimitEmail";
import { createLogger } from "../../../src/utils/logger/server";
import { captureException } from "../../../src/utils/posthogErrorCapture";
import type {
  LicensePurchaseNotificationPayload,
  PlanLimitNotificationContext,
  SubscriptionNotificationPayload,
} from "../types";

const logger = createLogger("ee:notification-service");

const SLACK_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface UsageLimitEmailData {
  organizationName: string;
  usagePercentage: number;
  usagePercentageFormatted: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  crossedThreshold: number;
  projectUsageData: Array<{ id: string; name: string; messageCount: number }>;
  actionUrl: string;
  logoUrl: string;
  severity: string;
}

// ---------------------------------------------------------------------------
// Helpers (absorbed from billingNotificationRegistration.ts)
// ---------------------------------------------------------------------------

type NotificationBase = {
  organizationId: string;
  organizationName: string;
  plan: string;
};

type ProspectiveNotification = NotificationBase & {
  type: "prospective";
  customerName?: string;
  customerEmail?: string;
  note?: string;
  actorEmail?: string;
};

type ConfirmedNotification = NotificationBase & {
  type: "confirmed";
  subscriptionId: string;
  startDate?: Date | null;
  maxMembers?: number | null;
  maxMessagesPerMonth?: number | null;
};

const getAppUrl = () => env.BASE_HOST ?? "https://app.langwatch.ai";

const getAdminLink = (organizationId: string) =>
  `${getAppUrl()}/admin#/organizations/${organizationId}`;

const formatNumber = (value?: number | null) =>
  typeof value === "number" ? value.toLocaleString() : "-";

const formatDate = (value?: Date | null) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value)
    : "Now";

const buildProspectiveBlocks = (
  payload: ProspectiveNotification,
): IncomingWebhookSendArguments["blocks"] => {
  const blocks: IncomingWebhookSendArguments["blocks"] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Prospective subscription interest" },
    },
  ];

  const dataBlock = {
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Organization:* ${payload.organizationName}` },
      { type: "mrkdwn", text: `*Plan:* ${payload.plan}` },
      {
        type: "mrkdwn",
        text: `*Customer:* ${payload.customerName ?? "Unknown"}`,
      },
    ],
  };

  if (payload.note) {
    dataBlock.fields.push({
      type: "mrkdwn",
      text: `_${payload.note}_`,
    });
  }

  blocks.push(dataBlock);

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Triggered by ${payload.customerName ?? "a team member"}`,
      },
    ],
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open org in admin" },
        url: getAdminLink(payload.organizationId),
        action_id: "subscription_prospective_admin",
        style: "primary",
      },
    ],
  });

  return blocks;
};

const buildConfirmedBlocks = (
  payload: ConfirmedNotification,
): IncomingWebhookSendArguments["blocks"] => {
  const startText = payload.startDate
    ? `Activated on ${formatDate(payload.startDate)}`
    : "Activated just now";

  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Subscription activated" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${payload.organizationName}* is live on *${payload.plan}*.`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Subscription ID:* ${payload.subscriptionId}`,
        },
        {
          type: "mrkdwn",
          text: `*Start Date:* ${formatDate(payload.startDate)}`,
        },
        {
          type: "mrkdwn",
          text: `*Seats:* ${formatNumber(payload.maxMembers)}`,
        },
        {
          type: "mrkdwn",
          text: `*Traces/month:* ${formatNumber(payload.maxMessagesPerMonth)}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: startText,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open org in admin" },
          url: getAdminLink(payload.organizationId),
          action_id: "subscription_confirmed_admin",
        },
      ],
    },
  ];
};

// ---------------------------------------------------------------------------
// NotificationService - Channel dispatch (HOW to send)
// ---------------------------------------------------------------------------

/**
 * Channel dispatch service: owns all delivery channels (email, Slack, Hubspot).
 * Contains no business logic -- just "send X via channel Y."
 *
 * Absorbed from:
 * - billingNotificationRegistration.ts (Slack/Hubspot implementations)
 * - slackLicenseNotification.ts (Slack license purchase)
 * - notificationHandlers.ts (error safety wrapper)
 */
export class NotificationService {
  /**
   * Factory method for creating a NotificationService.
   */
  static create(): NotificationService {
    return new NotificationService();
  }

  // -------------------------------------------------------------------------
  // Email
  // -------------------------------------------------------------------------

  /**
   * Sends a usage-limit warning email to the specified recipient.
   */
  async sendUsageLimitEmail({
    to,
    orgName,
    usageData,
  }: {
    to: string;
    orgName: string;
    usageData: UsageLimitEmailData;
  }): Promise<void> {
    try {
      await sendUsageLimitEmail({
        to,
        organizationName: orgName,
        usagePercentage: usageData.usagePercentage,
        usagePercentageFormatted: usageData.usagePercentageFormatted,
        currentMonthMessagesCount: usageData.currentMonthMessagesCount,
        maxMonthlyUsageLimit: usageData.maxMonthlyUsageLimit,
        crossedThreshold: usageData.crossedThreshold,
        projectUsageData: usageData.projectUsageData,
        actionUrl: usageData.actionUrl,
        logoUrl: usageData.logoUrl,
        severity: usageData.severity,
      });
    } catch (error) {
      logger.error({ error, to }, "Failed to send usage limit email");
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Slack
  // -------------------------------------------------------------------------

  /**
   * Sends a Slack alert when a plan limit is reached.
   */
  async sendSlackPlanLimitAlert(
    context: PlanLimitNotificationContext,
  ): Promise<void> {
    const url = process.env.SLACK_PLAN_LIMIT_CHANNEL;
    if (!url) {
      return;
    }

    try {
      const webhook = new IncomingWebhook(url);
      await webhook.send({
        text: `Plan limit reached: ${context.organizationName}, ${context.adminEmail ?? "unknown"}, Plan: ${context.planName}`,
      });
    } catch (error) {
      logger.error({ error }, "Failed to send Slack plan-limit notification");
      captureException(error);
    }
  }

  /**
   * Sends a Slack notification for subscription events (prospective or confirmed).
   */
  async sendSlackSubscriptionEvent(
    payload: SubscriptionNotificationPayload,
  ): Promise<void> {
    const webhookUrl = process.env.SLACK_CHANNEL_SUBSCRIPTIONS;
    if (!webhookUrl) {
      logger.warn(
        "SLACK_CHANNEL_SUBSCRIPTIONS is not configured; skipping subscription notification",
      );
      return;
    }

    const blocks =
      payload.type === "prospective"
        ? buildProspectiveBlocks(payload)
        : buildConfirmedBlocks(payload);

    try {
      const webhook = new IncomingWebhook(webhookUrl);
      await webhook.send({ blocks });
    } catch (error) {
      logger.error(
        { error },
        "Failed to send Slack subscription notification",
      );
      captureException(error);
    }
  }

  /**
   * Sends a Slack notification for a license purchase.
   */
  async sendSlackLicensePurchase(
    payload: LicensePurchaseNotificationPayload,
  ): Promise<void> {
    const webhookUrl = process.env.SLACK_CHANNEL_SUBSCRIPTIONS;
    if (!webhookUrl) {
      return;
    }

    const amountFormatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: payload.currency,
    }).format(payload.amountPaid / 100);

    try {
      const webhook = new IncomingWebhook(webhookUrl, {
        timeout: SLACK_TIMEOUT_MS,
      });
      await webhook.send({
        text: "New License Purchase",
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "New License Purchase",
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Buyer:*\n${payload.buyerEmail}` },
              { type: "mrkdwn", text: `*Plan:*\n${payload.planType}` },
              { type: "mrkdwn", text: `*Seats:*\n${payload.seats}` },
              { type: "mrkdwn", text: `*Amount:*\n${amountFormatted}` },
            ],
          },
        ],
      });
    } catch (error) {
      logger.error(
        { error },
        "Failed to send Slack license purchase notification",
      );
      captureException(error);
    }
  }

  // -------------------------------------------------------------------------
  // Hubspot
  // -------------------------------------------------------------------------

  /**
   * Submits a HubSpot form when a plan limit is reached.
   */
  async sendHubspotPlanLimitForm(
    context: PlanLimitNotificationContext,
  ): Promise<void> {
    const hubspotPortalId = process.env.HUBSPOT_PORTAL_ID;
    const hubspotFormId = process.env.HUBSPOT_REACHED_LIMIT_FORM_ID;

    if (!hubspotPortalId || !hubspotFormId) {
      return;
    }

    const formData = {
      submittedAt: Date.now(),
      fields: [
        {
          objectTypeId: "0-1",
          name: "firstname",
          value: context.adminName,
        },
        {
          objectTypeId: "0-1",
          name: "company",
          value: context.organizationName,
        },
        {
          objectTypeId: "0-1",
          name: "email",
          value: context.adminEmail,
        },
      ],
      context: {
        pageUri: "app.langwatch.ai",
        pageName: "Plan Limit Reached",
      },
    };

    const url = `https://api.hsforms.com/submissions/v3/integration/submit/${hubspotPortalId}/${hubspotFormId}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        captureException(
          new Error(`HubSpot request failed: ${response.status}`),
        );
      }
    } catch (error) {
      logger.error(
        { error },
        "Failed to send HubSpot plan-limit notification",
      );
      captureException(error);
    }
  }
}
