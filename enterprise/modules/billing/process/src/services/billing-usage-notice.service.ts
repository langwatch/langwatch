import type {
  LicensePurchaseNotificationPayload,
  PlanLimitNotificationContext,
  ResourceLimitNotificationContext,
  SelfHostedSignalNotificationPayload,
  SignupNotificationPayload,
  SubscriptionNotificationPayload,
} from "@langwatch/enterprise-billing-contract";
import {
  billingThresholdFailureNotice,
  licensePurchaseNotice,
  planLimitReachedNotice,
  resourceLimitReachedNotice,
  selfHostedSignalNotice,
  subscriptionActivatedNotice,
  subscriptionCancelledNotice,
  subscriptionProspectiveNotice,
  type NoticeOrigin,
} from "@langwatch/internal-slack";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { billingAlertChannels } from "../channels/billing-alert-channels.registry.ts";
import type {
  BillingAlertChannel,
  BillingAlertMessage,
} from "../channels/billing-alert.channel.ts";
import { hubspotFormChannels } from "../channels/hubspot-form-channels.registry.ts";
import type { HubspotFormChannel } from "../channels/hubspot-form.channel.ts";
import { usageLimitEmailChannels } from "../channels/usage-limit-email-channels.registry.ts";
import type { UsageLimitEmailChannel } from "../channels/usage-limit-email.channel.ts";
import {
  type HubspotFormBody,
  hubspotFormUrl,
  planLimitFormBody,
  signupFormBody,
} from "../rules/billing-usage-notice-copy.rules.ts";
import {
  NullBillingErrorReporter,
  type BillingErrorReporter,
} from "./billing-error-reporter.service.ts";

const logger = createLogger("ee:notification-service");

const DEFAULT_APP_URL = "https://app.langwatch.ai";

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
  projectUsageData: { id: string; name: string; messageCount: number }[];
  actionUrl: string;
  logoUrl: string;
  severity: string;
}

// ---------------------------------------------------------------------------
// Helpers (absorbed from billingNotificationRegistration.ts)
// ---------------------------------------------------------------------------

type NotificationServiceOptions = {
  config: {
    baseHost?: string;
    slackPlanLimitChannel?: string;
    slackSignupsChannel?: string;
    slackSelfHostedChannel?: string;
    slackSubscriptionsChannel?: string;
    /** Stripe links open the test dashboard. */
    stripeTestMode?: boolean;
    hubspotPortalId?: string;
    hubspotReachedLimitFormId?: string;
    hubspotFormId?: string;
  };
  slack?: BillingAlertChannel;
  hubspotForms?: HubspotFormChannel;
  errorReporter?: BillingErrorReporter;
  usageLimitEmail?: UsageLimitEmailChannel;
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
  private readonly slack: BillingAlertChannel;
  private readonly hubspotForms: HubspotFormChannel;
  private readonly errorReporter: BillingErrorReporter;
  private readonly usageLimitEmail: UsageLimitEmailChannel;

  private constructor(options: NotificationServiceOptions) {
    this.config = options.config;
    this.slack = options.slack ?? billingAlertChannels.live.create();
    this.hubspotForms = options.hubspotForms ?? hubspotFormChannels.live.create();
    this.errorReporter = options.errorReporter ?? NullBillingErrorReporter.create();
    this.usageLimitEmail = options.usageLimitEmail ?? usageLimitEmailChannels.memory.create();
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

  /** Where and when a notice was sent, for its footer. */
  private origin(): NoticeOrigin {
    return {
      environment: new URL(this.config.baseHost ?? DEFAULT_APP_URL).host,
      sentAt: nowInstant().epochMilliseconds,
    };
  }

  /** The notice is built inside the try: a refused prop is reported like a failed send. */
  private async sendSlackMessage({
    channelUrl,
    message,
    missingConfigLog,
    errorLog,
  }: {
    channelUrl?: string;
    message: (origin: NoticeOrigin) => BillingAlertMessage;
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
      await this.slack.send({ webhookUrl: channelUrl, message: message(this.origin()) });
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
      message: (origin) =>
        planLimitReachedNotice.render({ props: this.limitProps(context), origin }),
      errorLog: "Failed to send Slack plan-limit notification",
    });
  }

  /**
   * Sends a Slack alert when a resource limit is reached.
   */
  async sendSlackResourceLimitAlert(context: ResourceLimitNotificationContext): Promise<void> {
    await this.sendSlackMessage({
      channelUrl: this.config.slackPlanLimitChannel,
      message: (origin) =>
        resourceLimitReachedNotice.render({ props: this.limitProps(context), origin }),
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
      message: (origin) =>
        billingThresholdFailureNotice.render({
          props: {
            stripeSubscriptionId,
            reason,
            stripeTestMode: this.config.stripeTestMode ?? false,
          },
          origin,
        }),
      missingConfigLog:
        "SLACK_CHANNEL_SUBSCRIPTIONS is not configured; skipping billing-threshold failure alert",
      errorLog: "Failed to send Slack billing-threshold failure notification",
    });
  }

  /**
   * Sends a Slack notification for subscription events (prospective, confirmed or cancelled).
   */
  async sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void> {
    const adminUrl = this.getAdminLink(payload.organizationId);

    await this.sendSlackMessage({
      channelUrl: this.config.slackSubscriptionsChannel,
      message: (origin) => {
        switch (payload.type) {
          case "prospective":
            return subscriptionProspectiveNotice.render({
              props: {
                organizationName: payload.organizationName,
                plan: payload.plan,
                customerName: payload.customerName,
                note: payload.note,
                adminUrl,
              },
              origin,
            });
          case "confirmed":
            return subscriptionActivatedNotice.render({
              props: {
                organizationName: payload.organizationName,
                plan: payload.plan,
                subscriptionId: payload.subscriptionId,
                startedAt: payload.startDate?.epochMilliseconds,
                seats: payload.maxMembers,
                tracesPerMonth: payload.maxMessagesPerMonth,
                adminUrl,
              },
              origin,
            });
          case "cancelled":
            return subscriptionCancelledNotice.render({
              props: {
                organizationName: payload.organizationName,
                plan: payload.plan,
                subscriptionId: payload.subscriptionId,
                cancelledAt: payload.cancellationDate?.epochMilliseconds,
                adminUrl,
              },
              origin,
            });
        }
      },
      missingConfigLog:
        "SLACK_CHANNEL_SUBSCRIPTIONS is not configured; skipping subscription notification",
      errorLog: "Failed to send Slack subscription notification",
    });
  }

  /**
   * Sends a Slack notification for a license purchase.
   */
  async sendSlackLicensePurchase(payload: LicensePurchaseNotificationPayload): Promise<void> {
    await this.sendSlackMessage({
      channelUrl: this.config.slackSubscriptionsChannel,
      message: (origin) => licensePurchaseNotice.render({ props: payload, origin }),
      errorLog: "Failed to send Slack license purchase notification",
    });
  }

  /** A self-hosted lead signal; falls back to the signups channel when unset. */
  async sendSlackSelfHostedSignal(payload: SelfHostedSignalNotificationPayload): Promise<void> {
    await this.sendSlackMessage({
      channelUrl: this.config.slackSelfHostedChannel ?? this.config.slackSignupsChannel,
      message: (origin) => selfHostedSignalNotice.render({ props: payload, origin }),
      missingConfigLog:
        "Neither SLACK_CHANNEL_SELF_HOSTED nor SLACK_CHANNEL_SIGNUPS is configured; skipping self-hosted signal",
      errorLog: "Failed to send Slack self-hosted signal notification",
    });
  }

  private limitProps(context: PlanLimitNotificationContext | ResourceLimitNotificationContext) {
    return { ...context, adminUrl: this.getAdminLink(context.organizationId) };
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

    try {
      const receipt = await this.hubspotForms.submit({ url, body: formData });

      if (!receipt.ok) {
        this.errorReporter.capture(new Error(`${rejectedMessage}: ${receipt.status}`));
      }
    } catch (error) {
      logger.error({ error }, errorLog);
      this.errorReporter.capture(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
