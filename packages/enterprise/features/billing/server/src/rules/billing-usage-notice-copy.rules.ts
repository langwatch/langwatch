import type { IncomingWebhookSendArguments } from "@slack/webhook";
import type {
  LicensePurchaseNotificationPayload,
  PlanLimitNotificationContext,
  ResourceLimitNotificationContext,
  SignupNotificationPayload,
  SubscriptionNotificationPayload,
} from "@langwatch/enterprise-billing-contract";

type SlackBlocks = IncomingWebhookSendArguments["blocks"];

type ProspectiveNotification = Extract<SubscriptionNotificationPayload, { type: "prospective" }>;

type ConfirmedNotification = Extract<SubscriptionNotificationPayload, { type: "confirmed" }>;

type CancelledNotification = Extract<SubscriptionNotificationPayload, { type: "cancelled" }>;

export type HubspotFormBody = {
  fields: Array<{ objectTypeId: string; name: string; value: string | undefined }>;
  context: { pageUri: string; pageName: string };
};

const HUBSPOT_FIELD_OBJECT_TYPE = "0-1";

export function planLimitAlertText(context: PlanLimitNotificationContext): string {
  return `Plan limit reached: ${context.organizationName}, ${context.adminEmail ?? "unknown"}, Plan: ${context.planName}, ${context.limitType}: ${context.current}/${context.max}`;
}

export function resourceLimitAlertText(context: ResourceLimitNotificationContext): string {
  return `Resource limit reached: ${context.organizationName}, ${context.adminEmail ?? "unknown"}, Plan: ${context.planName}, ${context.limitType}: ${context.current}/${context.max}`;
}

export function billingThresholdFailureText({
  stripeSubscriptionId,
  reason,
}: {
  stripeSubscriptionId: string;
  reason: string;
}): string {
  return (
    `Annual events billing threshold NOT set on ${stripeSubscriptionId}: ${reason}. ` +
    "This subscription will bill its event overage as one renewal invoice until the " +
    "threshold is applied — re-run the backfill or set it manually."
  );
}

export function signupAlertText(payload: SignupNotificationPayload): string {
  const details = [
    payload.phoneNumber,
    payload.utmCampaign ? `Campaign: ${payload.utmCampaign}` : null,
  ].filter(Boolean);
  const organizationDetails = details.length > 0 ? `, ${details.join(", ")}` : "";

  return `🔔 New user registered: ${payload.userName ?? "Unknown"}, ${payload.userEmail ?? "unknown"}. Organization: ${payload.organizationName ?? "Unknown"}${organizationDetails}`;
}

export function licensePurchaseBlocks({
  payload,
  amountFormatted,
}: {
  payload: LicensePurchaseNotificationPayload;
  amountFormatted: string;
}): SlackBlocks {
  return [
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
  ];
}

export function prospectiveBlocks({
  payload,
  adminLink,
}: {
  payload: ProspectiveNotification;
  adminLink: string;
}): SlackBlocks {
  const blocks: SlackBlocks = [
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
        url: adminLink,
        action_id: "subscription_prospective_admin",
        style: "primary",
      },
    ],
  });

  return blocks;
}

export function confirmedBlocks({
  payload,
  adminLink,
  startDateText,
  seatsText,
  messagesPerMonthText,
}: {
  payload: ConfirmedNotification;
  adminLink: string;
  startDateText: string;
  seatsText: string;
  messagesPerMonthText: string;
}): SlackBlocks {
  const startText = payload.startDate ? `Activated on ${startDateText}` : "Activated just now";

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
          text: `*Start Date:* ${startDateText}`,
        },
        {
          type: "mrkdwn",
          text: `*Seats:* ${seatsText}`,
        },
        {
          type: "mrkdwn",
          text: `*Traces/month:* ${messagesPerMonthText}`,
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
          url: adminLink,
          action_id: "subscription_confirmed_admin",
        },
      ],
    },
  ];
}

export function cancelledBlocks({
  payload,
  adminLink,
  cancellationDateText,
}: {
  payload: CancelledNotification;
  adminLink: string;
  cancellationDateText: string;
}): SlackBlocks {
  const cancelText = payload.cancellationDate
    ? `Cancelled on ${cancellationDateText}`
    : "Cancelled just now";

  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Subscription cancelled" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${payload.organizationName}* has cancelled *${payload.plan}*.`,
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
          text: `*Cancellation Date:* ${cancellationDateText}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: cancelText,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open org in admin" },
          url: adminLink,
          action_id: "subscription_cancelled_admin",
        },
      ],
    },
  ];
}

export function signupFormBody(payload: SignupNotificationPayload): HubspotFormBody {
  const nameParts = (payload.userName ?? "").split(" ").filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1]! : "";
  const signUpData = payload.signUpData;

  return {
    fields: [
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "company",
        value: payload.organizationName ?? "",
      },
      { objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE, name: "firstname", value: firstName },
      { objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE, name: "lastname", value: lastName },
      { objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE, name: "email", value: payload.userEmail ?? "" },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "mobilephone",
        value: payload.phoneNumber ?? "",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "Features_usage_multiple",
        value: signUpData?.featureUsage ?? "Other",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "user_role",
        value: signUpData?.yourRole ?? "Other",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "product_usage",
        value: signUpData?.usage ?? "",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "product_solution",
        value: signUpData?.solution ?? "",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "organization_size",
        value: signUpData?.companySize ?? "1",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "utm_campaign",
        value: signUpData?.utmCampaign ?? payload.utmCampaign ?? "",
      },
    ],
    context: {
      pageUri: "app.langwatch.ai",
      pageName: "Sign Up",
    },
  };
}

export function planLimitFormBody(context: PlanLimitNotificationContext): HubspotFormBody {
  return {
    fields: [
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "firstname",
        value: context.adminName,
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "company",
        value: context.organizationName,
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "email",
        value: context.adminEmail,
      },
    ],
    context: {
      pageUri: "app.langwatch.ai",
      pageName: "Plan Limit Reached",
    },
  };
}

export function hubspotFormUrl({ portalId, formId }: { portalId: string; formId: string }): string {
  return `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formId}`;
}
