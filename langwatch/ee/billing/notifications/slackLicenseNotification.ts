import type { LicensePurchaseNotificationPayload } from "../types";

const SLACK_TIMEOUT_MS = 10_000;

export const sendSlackLicensePurchaseNotification = async ({
  payload,
  webhookUrl,
}: {
  payload: LicensePurchaseNotificationPayload;
  webhookUrl: string;
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  const amountFormatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: payload.currency,
  }).format(payload.amountPaid / 100);

  const message = {
    text: `🎉 New License Purchase`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🎉 New License Purchase",
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
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Slack webhook failed with status ${response.status}: ${response.statusText}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
};
