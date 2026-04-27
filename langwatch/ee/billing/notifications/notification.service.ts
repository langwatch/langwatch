import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import { sendUsageLimitEmail } from "../../../src/server/mailer/usageLimitEmail";
import { createLogger } from "../../../src/utils/logger/server";
import { captureException } from "../../../src/utils/posthogErrorCapture";
import type { AppConfig } from "../../../src/server/app-layer/config";
import type {
  LicensePurchaseNotificationPayload,
  PlanLimitNotificationContext,
  ResourceLimitNotificationContext,
  SignupNotificationPayload,
  SubscriptionNotificationPayload,
} from "../types";

const logger = createLogger("ee:notification-service");

const DEFAULT_APP_URL = "https://app.langwatch.ai";
const EXTERNAL_SERVICE_TIMEOUT_MS = 10_000;

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

type ProspectiveNotification = Extract<
  SubscriptionNotificationPayload,
  { type: "prospective" }
>;

type ConfirmedNotification = Extract<
  SubscriptionNotificationPayload,
  { type: "confirmed" }
>;

type CancelledNotification = Extract<
  SubscriptionNotificationPayload,
  { type: "cancelled" }
>;

type NotificationServiceOptions = {
  config: Pick<
    AppConfig,
    | "baseHost"
    | "slackPlanLimitChannel"
    | "slackSignupsChannel"
    | "slackSubscriptionsChannel"
    | "hubspotPortalId"
    | "hubspotReachedLimitFormId"
    | "hubspotFormId"
  >;
  createSlackWebhook?: (url: string) => Pick<IncomingWebhook, "send">;
  fetchFn?: typeof fetch;
};

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
  adminLink: string,
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
        url: adminLink,
        action_id: "subscription_prospective_admin",
        style: "primary",
      },
    ],
  });

  return blocks;
};

const buildConfirmedBlocks = (
  payload: ConfirmedNotification,
  adminLink: string,
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
          url: adminLink,
          action_id: "subscription_confirmed_admin",
        },
      ],
    },
  ];
};

const buildCancelledBlocks = (
  payload: CancelledNotification,
  adminLink: string,
): IncomingWebhookSendArguments["blocks"] => {
  const cancelText = payload.cancellationDate
    ? `Cancelled on ${formatDate(payload.cancellationDate)}`
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
          text: `*Cancellation Date:* ${formatDate(payload.cancellationDate)}`,
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
  private readonly config: NotificationServiceOptions["config"];
  private readonly createSlackWebhook: (
    url: string,
  ) => Pick<IncomingWebhook, "send">;
  private readonly fetchFn: typeof fetch;

  private constructor(options: NotificationServiceOptions) {
    this.config = options.config;
    this.createSlackWebhook =
      options?.createSlackWebhook ??
      ((url) =>
        new IncomingWebhook(url, {
          timeout: EXTERNAL_SERVICE_TIMEOUT_MS,
        }));
    this.fetchFn =
      options?.fetchFn ??
      ((...args) => fetch(...args)) as typeof fetch;
  }

  /**
   * Factory method for creating a NotificationService.
   */
  static create(options: NotificationServiceOptions): NotificationService {
    return new NotificationService(options);
  }

  /**
   * Null-object factory: every method is a silent noop.
   * Use in tests or non-SaaS deployments where no notifications are needed.
   */
  static createNull(): NotificationService {
    return NotificationService.create({
      config: {} as NotificationServiceOptions["config"],
    });
  }

  private getAdminLink(organizationId: string): string {
    return `${this.config.baseHost ?? DEFAULT_APP_URL}/admin#/organizations/${organizationId}`;
  }

  private async sendSlackMessage({
    channelUrl,
    body,
    missingConfigLog,
    errorLog,
  }: {
    channelUrl?: string;
    body: IncomingWebhookSendArguments;
    missingConfigLog?: string;
    errorLog: string;
  }): Promise<void> {
    if (!channelUrl) {
      if (missingConfigLog) {
        logger.warn(missingConfigLog);
      }
      return;
    }

    try {
      const webhook = this.createSlackWebhook(channelUrl);
      await webhook.send(body);
    } catch (error) {
      logger.error({ error }, errorLog);
      captureException(error);
    }
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
    await this.sendSlackMessage({
      channelUrl: this.config.slackPlanLimitChannel,
      body: {
        text: `Plan limit reached: ${context.organizationName}, ${context.adminEmail ?? "unknown"}, Plan: ${context.planName}`,
      },
      errorLog: "Failed to send Slack plan-limit notification",
    });
  }

  /**
   * Sends a Slack alert when a resource limit is reached.
   */
  async sendSlackResourceLimitAlert(
    context: ResourceLimitNotificationContext,
  ): Promise<void> {
    await this.sendSlackMessage({
      channelUrl: this.config.slackPlanLimitChannel,
      body: {
        text: `Resource limit reached: ${context.organizationName}, ${context.adminEmail ?? "unknown"}, Plan: ${context.planName}, ${context.limitType}: ${context.current}/${context.max}`,
      },
      errorLog: "Failed to send Slack resource-limit notification",
    });
  }

  /**
   * Sends a Slack notification for subscription events (prospective or confirmed).
   */
  async sendSlackSubscriptionEvent(
    payload: SubscriptionNotificationPayload,
  ): Promise<void> {
    const adminLink = this.getAdminLink(payload.organizationId);

    let blocks: IncomingWebhookSendArguments["blocks"];
    switch (payload.type) {
      case "prospective":
        blocks = buildProspectiveBlocks(payload, adminLink);
        break;
      case "confirmed":
        blocks = buildConfirmedBlocks(payload, adminLink);
        break;
      case "cancelled":
        blocks = buildCancelledBlocks(payload, adminLink);
        break;
    }

    await this.sendSlackMessage({
      channelUrl: this.config.slackSubscriptionsChannel,
      body: { blocks },
      missingConfigLog:
        "SLACK_CHANNEL_SUBSCRIPTIONS is not configured; skipping subscription notification",
      errorLog: "Failed to send Slack subscription notification",
    });
  }

  /**
   * Sends a Slack notification for a new signup.
   */
  async sendSlackSignupEvent(payload: SignupNotificationPayload): Promise<void> {
    const details = [
      payload.phoneNumber,
      payload.utmCampaign ? `Campaign: ${payload.utmCampaign}` : null,
    ].filter(Boolean);

    const organizationDetails =
      details.length > 0 ? `, ${details.join(", ")}` : "";

    await this.sendSlackMessage({
      channelUrl: this.config.slackSignupsChannel,
      body: {
        text: `🔔 New user registered: ${payload.userName ?? "Unknown"}, ${payload.userEmail ?? "unknown"}. Organization: ${payload.organizationName ?? "Unknown"}${organizationDetails}`,
      },
      missingConfigLog:
        "SLACK_CHANNEL_SIGNUPS is not configured; skipping signup notification",
      errorLog: "Failed to send Slack signup notification",
    });
  }

  /**
   * Sends a Slack notification for a license purchase.
   */
  async sendSlackLicensePurchase(
    payload: LicensePurchaseNotificationPayload,
  ): Promise<void> {
    const amountFormatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: payload.currency,
    }).format(payload.amountPaid / 100);

    await this.sendSlackMessage({
      channelUrl: this.config.slackSubscriptionsChannel,
      body: {
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
      },
      errorLog: "Failed to send Slack license purchase notification",
    });
  }

  // -------------------------------------------------------------------------
  // Hubspot
  // -------------------------------------------------------------------------

  /**
   * Submits a HubSpot signup lead form when a new user registers.
   */
  async sendHubspotSignupForm(
    payload: SignupNotificationPayload,
  ): Promise<void> {
    const { hubspotPortalId, hubspotFormId } = this.config;

    if (!hubspotPortalId || !hubspotFormId) {
      return;
    }

    const nameParts = (payload.userName ?? "").split(" ").filter(Boolean);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1]! : "";

    const signUpData = payload.signUpData;

    const formData = {
      submittedAt: Date.now(),
      fields: [
        { objectTypeId: "0-1", name: "company", value: payload.organizationName ?? "" },
        { objectTypeId: "0-1", name: "firstname", value: firstName },
        { objectTypeId: "0-1", name: "lastname", value: lastName },
        { objectTypeId: "0-1", name: "email", value: payload.userEmail ?? "" },
        { objectTypeId: "0-1", name: "mobilephone", value: payload.phoneNumber ?? "" },
        { objectTypeId: "0-1", name: "Features_usage_multiple", value: signUpData?.featureUsage ?? "Other" },
        { objectTypeId: "0-1", name: "user_role", value: signUpData?.yourRole ?? "Other" },
        { objectTypeId: "0-1", name: "product_usage", value: signUpData?.usage ?? "" },
        { objectTypeId: "0-1", name: "product_solution", value: signUpData?.solution ?? "" },
        { objectTypeId: "0-1", name: "organization_size", value: signUpData?.companySize ?? "1" },
        { objectTypeId: "0-1", name: "utm_campaign", value: signUpData?.utmCampaign ?? payload.utmCampaign ?? "" },
      ],
      context: {
        pageUri: "app.langwatch.ai",
        pageName: "Sign Up",
      },
    };

    const url = `https://api.hsforms.com/submissions/v3/integration/submit/${hubspotPortalId}/${hubspotFormId}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EXTERNAL_SERVICE_TIMEOUT_MS,
    );

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
        signal: controller.signal,
      });

      if (!response.ok) {
        captureException(
          new Error(`HubSpot signup form request failed: ${response.status}`),
        );
      }
    } catch (error) {
      logger.error(
        { error },
        "Failed to send HubSpot signup form notification",
      );
      captureException(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Submits a HubSpot form when a plan limit is reached.
   */
  async sendHubspotPlanLimitForm(
    context: PlanLimitNotificationContext,
  ): Promise<void> {
    const { hubspotPortalId, hubspotReachedLimitFormId } = this.config;

    if (!hubspotPortalId || !hubspotReachedLimitFormId) {
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

    const url = `https://api.hsforms.com/submissions/v3/integration/submit/${hubspotPortalId}/${hubspotReachedLimitFormId}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EXTERNAL_SERVICE_TIMEOUT_MS,
    );

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
        signal: controller.signal,
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
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
