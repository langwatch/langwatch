import { createLogger } from "@langwatch/observability";
import { IncomingWebhook, type IncomingWebhookSendArguments } from "@slack/webhook";
import { nowInstant } from "@langwatch/time";
import type {
  LicensePurchaseNotificationPayload,
  PlanLimitNotificationContext,
  ResourceLimitNotificationContext,
  SignupNotificationPayload,
  SubscriptionNotificationPayload,
} from "@langwatch/enterprise-billing-contract";
import {
  NullBillingErrorReporter,
  type BillingErrorReporter,
} from "../ports/error-reporter.port.ts";
import {
  NullUsageLimitEmailAdapter,
  type UsageLimitEmailPort,
} from "../ports/usage-limit-email.port.ts";
import {
  type HubspotFormBody,
  billingThresholdFailureText,
  cancelledBlocks,
  confirmedBlocks,
  hubspotFormUrl,
  licensePurchaseBlocks,
  planLimitAlertText,
  planLimitFormBody,
  prospectiveBlocks,
  resourceLimitAlertText,
  signupAlertText,
  signupFormBody,
} from "../rules/billing-usage-notice-copy.rules.ts";
import { toDate, type Instant } from "@langwatch/time";

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
  /** What this organization is metered in, as its own meter reports it. */
  usageUnit?: "traces" | "events";
  /**
   * Where this organization can go next, resolved for THIS organization by
   * `PlanNextStepService`. Shaped to match `@langwatch/mail`'s
   * `usageLimitEmailProps.nextStep` without this package depending on it.
   */
  nextStep?:
    | {
        kind: "self_serve";
        name: string;
        url: string;
        price: number;
        currency: string;
        billingPeriod: "monthly" | "annual";
        pricedPerSeat?: boolean;
        raisesLimitTo: number;
      }
    | { kind: "account_team"; contactUrl: string };
}

// ---------------------------------------------------------------------------
// Helpers (absorbed from billingNotificationRegistration.ts)
// ---------------------------------------------------------------------------

type NotificationServiceOptions = {
  config: {
    baseHost?: string;
    slackPlanLimitChannel?: string;
    slackSignupsChannel?: string;
    slackSubscriptionsChannel?: string;
    hubspotPortalId?: string;
    hubspotReachedLimitFormId?: string;
    hubspotFormId?: string;
  };
  createSlackWebhook?: (url: string) => Pick<IncomingWebhook, "send">;
  fetchFn?: typeof fetch;
  errorReporter?: BillingErrorReporter;
  usageLimitEmail?: UsageLimitEmailPort;
};

// ---------------------------------------------------------------------------
// NotificationService - Channel dispatch (HOW to send)
// ---------------------------------------------------------------------------

/**
 * Channel dispatch service: owns all delivery channels (email, Slack, Hubspot). Contains
 * no business logic -- just "send X via channel Y."
 */
export class NotificationService {
  private readonly config: NotificationServiceOptions["config"];
  private readonly createSlackWebhook: (url: string) => Pick<IncomingWebhook, "send">;
  private readonly fetchFn: typeof fetch;
  private readonly errorReporter: BillingErrorReporter;
  private readonly usageLimitEmail: UsageLimitEmailPort;

  private constructor(options: NotificationServiceOptions) {
    this.config = options.config;
    this.createSlackWebhook =
      options?.createSlackWebhook ??
      ((url) =>
        new IncomingWebhook(url, {
          timeout: EXTERNAL_SERVICE_TIMEOUT_MS,
        }));
    this.fetchFn = options?.fetchFn ?? (((...args) => fetch(...args)) as typeof fetch);
    this.errorReporter = options.errorReporter ?? NullBillingErrorReporter.create();
    this.usageLimitEmail = options.usageLimitEmail ?? NullUsageLimitEmailAdapter.create();
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
      this.errorReporter.capture(error instanceof Error ? error : new Error(String(error)));
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
      await this.usageLimitEmail.send({
        to,
        organizationName: orgName,
        usage: usageData,
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
  async sendSlackPlanLimitAlert(context: PlanLimitNotificationContext): Promise<void> {
    await this.sendSlackMessage({
      channelUrl: this.config.slackPlanLimitChannel,
      body: { text: planLimitAlertText(context) },
      errorLog: "Failed to send Slack plan-limit notification",
    });
  }

  /**
   * Sends a Slack alert when a resource limit is reached.
   */
  async sendSlackResourceLimitAlert(context: ResourceLimitNotificationContext): Promise<void> {
    await this.sendSlackMessage({
      channelUrl: this.config.slackPlanLimitChannel,
      body: { text: resourceLimitAlertText(context) },
      errorLog: "Failed to send Slack resource-limit notification",
    });
  }

  /**
   * Sends a Slack alert when an annual subscription could not be given its events billing
   * threshold.
   */
  async sendSlackBillingThresholdFailureAlert({
    stripeSubscriptionId,
    reason,
  }: {
    stripeSubscriptionId: string;
    reason: string;
  }): Promise<void> {
    await this.sendSlackMessage({
      channelUrl: this.config.slackSubscriptionsChannel,
      body: { text: billingThresholdFailureText({ stripeSubscriptionId, reason }) },
      missingConfigLog:
        "SLACK_CHANNEL_SUBSCRIPTIONS is not configured; skipping billing-threshold failure alert",
      errorLog: "Failed to send Slack billing-threshold failure notification",
    });
  }

  /**
   * Sends a Slack notification for subscription events (prospective or confirmed).
   */
  async sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void> {
    const adminLink = this.getAdminLink(payload.organizationId);

    let blocks: IncomingWebhookSendArguments["blocks"];
    switch (payload.type) {
      case "prospective":
        blocks = prospectiveBlocks({ payload, adminLink });
        break;
      case "confirmed":
        blocks = confirmedBlocks({
          payload,
          adminLink,
          startDateText: NotificationService.formatDate(payload.startDate),
          seatsText: NotificationService.formatNumber(payload.maxMembers),
          messagesPerMonthText: NotificationService.formatNumber(payload.maxMessagesPerMonth),
        });
        break;
      case "cancelled":
        blocks = cancelledBlocks({
          payload,
          adminLink,
          cancellationDateText: NotificationService.formatDate(payload.cancellationDate),
        });
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
    await this.sendSlackMessage({
      channelUrl: this.config.slackSignupsChannel,
      body: { text: signupAlertText(payload) },
      missingConfigLog: "SLACK_CHANNEL_SIGNUPS is not configured; skipping signup notification",
      errorLog: "Failed to send Slack signup notification",
    });
  }

  /**
   * Sends a Slack notification for a license purchase.
   */
  async sendSlackLicensePurchase(payload: LicensePurchaseNotificationPayload): Promise<void> {
    const amountFormatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: payload.currency,
    }).format(payload.amountPaid / 100);

    await this.sendSlackMessage({
      channelUrl: this.config.slackSubscriptionsChannel,
      body: {
        text: "New License Purchase",
        blocks: licensePurchaseBlocks({ payload, amountFormatted }),
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
  async sendHubspotSignupForm(payload: SignupNotificationPayload): Promise<void> {
    const { hubspotPortalId, hubspotFormId } = this.config;

    if (!hubspotPortalId || !hubspotFormId) {
      return;
    }

    await this.submitHubspotForm({
      url: hubspotFormUrl({ portalId: hubspotPortalId, formId: hubspotFormId }),
      body: signupFormBody(payload),
      rejectedMessage: "HubSpot signup form request failed",
      errorLog: "Failed to send HubSpot signup form notification",
    });
  }

  /**
   * Submits a HubSpot form when a plan limit is reached.
   */
  async sendHubspotPlanLimitForm(context: PlanLimitNotificationContext): Promise<void> {
    const { hubspotPortalId, hubspotReachedLimitFormId } = this.config;

    if (!hubspotPortalId || !hubspotReachedLimitFormId) {
      return;
    }

    await this.submitHubspotForm({
      url: hubspotFormUrl({ portalId: hubspotPortalId, formId: hubspotReachedLimitFormId }),
      body: planLimitFormBody(context),
      rejectedMessage: "HubSpot request failed",
      errorLog: "Failed to send HubSpot plan-limit notification",
    });
  }

  private async submitHubspotForm({
    url,
    body,
    rejectedMessage,
    errorLog,
  }: {
    url: string;
    body: HubspotFormBody;
    rejectedMessage: string;
    errorLog: string;
  }): Promise<void> {
    const formData = { submittedAt: nowInstant().epochMilliseconds, ...body };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_SERVICE_TIMEOUT_MS);

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
        this.errorReporter.capture(new Error(`${rejectedMessage}: ${response.status}`));
      }
    } catch (error) {
      logger.error({ error }, errorLog);
      this.errorReporter.capture(error instanceof Error ? error : new Error(String(error)));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static formatNumber(value?: number | null) {
    return typeof value === "number" ? value.toLocaleString() : "-";
  }

  private static formatDate(value?: Instant | null) {
    return value
      ? new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(toDate(value))
      : "Now";
  }
}
