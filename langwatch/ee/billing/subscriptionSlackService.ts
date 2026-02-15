import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import { env } from "../../src/env.mjs";
import { createLogger } from "../../src/utils/logger/server";
import type { PlanTypes } from "./planTypes";

const logger = createLogger("langwatch:notifications:subscriptionSlack");

type SubscriptionPlan = PlanTypes | string;

type NotificationBase = {
  organizationId: string;
  organizationName: string;
  plan: SubscriptionPlan;
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

export type SubscriptionSlackNotificationPayload =
  | ProspectiveNotification
  | ConfirmedNotification;

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

const sendSlackBlocks = async (
  blocks: IncomingWebhookSendArguments["blocks"],
) => {
  const webhookUrl = process.env.SLACK_CHANNEL_SUBSCRIPTIONS;
  if (!webhookUrl) {
    logger.warn(
      "SLACK_CHANNEL_SUBSCRIPTIONS is not configured; skipping subscription notification",
    );
    return;
  }

  try {
    const webhook = new IncomingWebhook(webhookUrl);
    await webhook.send({ blocks });
  } catch (error) {
    logger.error({ error }, "Failed to send subscription Slack notification");
  }
};

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

export const sendSubscriptionSlackNotification = async (
  payload: SubscriptionSlackNotificationPayload,
) => {
  const blocks =
    payload.type === "prospective"
      ? buildProspectiveBlocks(payload)
      : buildConfirmedBlocks(payload);

  await sendSlackBlocks(blocks);
};
