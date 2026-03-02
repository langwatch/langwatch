import type { LicensePurchaseNotificationPayload } from "../types";

export const sendSlackLicensePurchaseNotification = async ({
  payload,
  webhookUrl,
}: {
  payload: LicensePurchaseNotificationPayload;
  webhookUrl: string;
}) => {
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

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(
      `Slack webhook failed with status ${response.status}: ${response.statusText}`,
    );
  }
};
