/**
 * Warning an organization that it is approaching its monthly usage limit.
 */

import { createLogger } from "@langwatch/observability";
import {
  NOTIFICATION_TYPES,
  USAGE_UNKNOWN,
  type BillingPricingModel,
  type BillingUsageCounter,
  type BillingUsageLimitOrganization,
  type UsageLimitData,
} from "@langwatch/enterprise-billing-contract";
import type {
  NotificationService as NotificationRecordService,
  Notification,
} from "@langwatch/notification-contract";
import type { NotificationService, UsageLimitEmailData } from "./billing-usage-notice.service";

const logger = createLogger("langwatch:notifications:usageWarning");

/** What an organization's usage is metered in, resolved by the deployment's own meter policy. */
export type BillingUsageUnit = "traces" | "events";

/**
 * Where this organization can go next, as `UsageLimitEmailData["nextStep"]` shapes it.
 *
 * A plain structural type rather than an import of `PlanNextStepService`: this package
 * does not depend on `@langwatch/entitlement-server`. Reading the organization's own
 * plan is this collaborator's job too — folding it in here, rather than taking a
 * separate `plans` port, keeps the FULL `Plan` shape `PlanNextStepService.resolve`
 * needs out of this package, which only ever sees the result.
 */
export type BillingNextStepResolver = {
  resolve(input: {
    organizationId: string;
    pricingModel: BillingPricingModel | null;
    currency: "USD" | "EUR";
  }): Promise<NonNullable<UsageLimitEmailData["nextStep"]> | undefined>;
};

/** Ascending, so the last one passed is the highest one crossed. */
const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const;

const getCurrentMonthStart = (): Date => {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

export type UsageWarningServiceOptions = {
  records: NotificationRecordService;
  organizations: BillingUsageLimitOrganization;
  usageCounts: BillingUsageCounter;
  emails: NotificationService;
  baseHost: string;
  /** Resolves where the organization can go next. Absent skips the hook. */
  nextStep?: BillingNextStepResolver;
  /** What the organization is metered in, from the deployment's own meter policy. */
  usageUnit?: (input: { organizationId: string }) => Promise<BillingUsageUnit | undefined>;
};

export class UsageWarningService {
  private readonly records: NotificationRecordService;
  private readonly organizations: BillingUsageLimitOrganization;
  private readonly usageCounts: BillingUsageCounter;
  private readonly emails: NotificationService;
  private readonly baseHost: string;
  private readonly nextStep: BillingNextStepResolver | undefined;
  private readonly resolveUsageUnit:
    | ((input: { organizationId: string }) => Promise<BillingUsageUnit | undefined>)
    | undefined;

  static create(options: UsageWarningServiceOptions): UsageWarningService {
    return new UsageWarningService(options);
  }

  private constructor(options: UsageWarningServiceOptions) {
    this.records = options.records;
    this.organizations = options.organizations;
    this.usageCounts = options.usageCounts;
    this.emails = options.emails;
    this.baseHost = options.baseHost;
    this.nextStep = options.nextStep;
    this.resolveUsageUnit = options.usageUnit;
  }

  /**
   * Sends a usage-limit warning email if one is due, and records that it went.
   */
  async tryCheckAndSendWarning(data: UsageLimitData): Promise<Notification | null> {
    const { organizationId, currentMonthMessagesCount, maxMonthlyUsageLimit } = data;

    const usagePercentage =
      maxMonthlyUsageLimit > 0 ? (currentMonthMessagesCount / maxMonthlyUsageLimit) * 100 : 0;
    const crossedThreshold = this.calculateThreshold(usagePercentage);

    if (!crossedThreshold) {
      logger.debug(
        { organizationId, usagePercentage, lowestThreshold: USAGE_WARNING_THRESHOLDS[0] },
        "Usage below all warning thresholds, skipping notification",
      );

      return null;
    }

    const organization = await this.organizations.findWithAdmins(organizationId);

    if (!organization) {
      logger.warn({ organizationId }, "Organization not found");

      return null;
    }

    if (organization.members.length === 0) {
      logger.warn({ organizationId }, "No admin members found for organization");

      return null;
    }

    if (await this.alreadyWarnedThisMonth({ organizationId, crossedThreshold })) {
      return null;
    }

    const projectUsageData = await this.projectUsage({ organizationId, crossedThreshold });
    if (projectUsageData === null) {
      return null;
    }

    const deliverableAdmins = organization.members.filter((member) => member.user.email);

    if (deliverableAdmins.length === 0) {
      logger.info(
        {
          organizationId,
          totalAdmins: organization.members.length,
          usagePercentage: usagePercentage.toFixed(2),
          threshold: crossedThreshold,
        },
        "No admins with email addresses found, skipping notification (no deliverable recipients)",
      );

      return null;
    }

    return this.sendAndRecord({
      organizationId,
      organizationName: organization.name,
      deliverableAdmins,
      emailContext: await this.buildEmailContext({
        organizationId,
        organizationName: organization.name,
        pricingModel: organization.pricingModel,
        currency: organization.currency,
        usagePercentage,
        currentMonthMessagesCount,
        maxMonthlyUsageLimit,
        crossedThreshold,
        projectUsageData,
      }),
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      usagePercentage,
      crossedThreshold,
    });
  }

  /**
   * Whether this threshold was already warned about in the current calendar month.
   */
  private async alreadyWarnedThisMonth({
    organizationId,
    crossedThreshold,
  }: {
    organizationId: string;
    crossedThreshold: number;
  }): Promise<boolean> {
    const currentMonthStart = getCurrentMonthStart();

    const recentNotifications = await this.records.listRecentByOrganization({
      organizationId,
      since: currentMonthStart,
    });

    const alreadySent = recentNotifications.find((notification) => {
      if (!notification.metadata || typeof notification.metadata !== "object") {
        return false;
      }

      const metadata = notification.metadata as Record<string, unknown>;

      return (
        metadata.type === NOTIFICATION_TYPES.USAGE_LIMIT_WARNING &&
        metadata.threshold === crossedThreshold
      );
    });

    if (!alreadySent) {
      return false;
    }

    logger.debug(
      {
        organizationId,
        threshold: crossedThreshold,
        lastSentAt: alreadySent.sentAt,
        currentMonthStart,
      },
      "Notification already sent for this threshold in current calendar month, skipping duplicate",
    );

    return true;
  }

  /**
   * Per-project message counts, or null when they cannot be read.
   */
  private async projectUsage({
    organizationId,
    crossedThreshold,
  }: {
    organizationId: string;
    crossedThreshold: number;
  }): Promise<Array<{ id: string; name: string; messageCount: number }> | null> {
    const projects = await this.organizations.findProjectsWithName(organizationId);
    const counts = await this.usageCounts.getCountByProjects({
      organizationId,
      projectIds: projects.map((project) => project.id),
    });

    if (counts === USAGE_UNKNOWN) {
      logger.warn(
        { organizationId, crossedThreshold },
        "usage is unknown, skipping usage-limit email rather than reporting zeros",
      );

      return null;
    }

    const countsMap = new Map(counts.map((count) => [count.projectId, count.count]));

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      messageCount: countsMap.get(project.id) ?? 0,
    }));
  }

  /**
   * Sends to every deliverable admin and records that it happened.
   */
  private async sendAndRecord({
    organizationId,
    organizationName,
    deliverableAdmins,
    emailContext,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    usagePercentage,
    crossedThreshold,
  }: {
    organizationId: string;
    organizationName: string;
    deliverableAdmins: Array<{ user: { id: string; name: string | null; email: string | null } }>;
    emailContext: UsageLimitEmailData;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    usagePercentage: number;
    crossedThreshold: number;
  }): Promise<Notification> {
    try {
      const { recipientsSuccessCount, recipientsFailureCount, failedRecipients } =
        await this.dispatchEmails({
          organizationId,
          organizationName,
          deliverableAdmins,
          emailContext,
        });

      if (recipientsSuccessCount === 0) {
        logger.error(
          {
            organizationId,
            recipientsFailureCount,
            failedRecipients,
            usagePercentage: usagePercentage.toFixed(2),
            threshold: crossedThreshold,
          },
          "All usage limit warning emails failed to send, aborting notification creation to allow retries",
        );

        throw new Error(`All ${recipientsFailureCount} usage limit warning emails failed to send`);
      }

      const notification = await this.recordNotification({
        organizationId,
        currentMonthMessagesCount,
        maxMonthlyUsageLimit,
        usagePercentage,
        crossedThreshold,
        deliverableAdminsCount: deliverableAdmins.length,
        recipientsSuccessCount,
        recipientsFailureCount,
        failedRecipients,
      });

      logger.info(
        {
          organizationId,
          notificationId: notification.id,
          recipientsCount: deliverableAdmins.length,
          recipientsSuccessCount,
          recipientsFailureCount,
          ...(recipientsFailureCount > 0 && { failedRecipients }),
          usagePercentage: usagePercentage.toFixed(2),
          threshold: crossedThreshold,
        },
        "Usage limit warning notifications sent successfully",
      );

      return notification;
    } catch (error) {
      logger.error({ error, organizationId }, "Error sending usage limit warning notifications");

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers for tryCheckAndSendWarning
  // -------------------------------------------------------------------------

  /**
   * Finds the highest warning threshold crossed by the current usage percentage.
   */
  private calculateThreshold(
    usagePercentage: number,
  ): (typeof USAGE_WARNING_THRESHOLDS)[number] | undefined {
    let crossed: (typeof USAGE_WARNING_THRESHOLDS)[number] | undefined;
    for (const threshold of USAGE_WARNING_THRESHOLDS) {
      if (usagePercentage >= threshold) {
        crossed = threshold;
      }
    }

    return crossed;
  }

  /**
   * Builds the email data object with severity, formatting, and presentation constants.
   */
  private async buildEmailContext({
    organizationId,
    organizationName,
    pricingModel,
    currency,
    usagePercentage,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    crossedThreshold,
    projectUsageData,
  }: {
    organizationId: string;
    organizationName: string;
    pricingModel: BillingPricingModel | null;
    currency: "USD" | "EUR";
    usagePercentage: number;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    crossedThreshold: number;
    projectUsageData: Array<{ id: string; name: string; messageCount: number }>;
  }): Promise<UsageLimitEmailData> {
    const actionUrl = `${this.baseHost}/settings/usage`;

    const [usageUnit, nextStep] = await Promise.all([
      this.tryResolveUsageUnit({ organizationId }),
      this.tryResolveNextStep({ organizationId, pricingModel, currency }),
    ]);

    const logoUrl =
      "https://hs-143534269.f.hubspotstarter-eu1.net/hub/143534269/hubfs/header-3.png?width=1116&upscale=true&name=header-3.png";

    const cappedPercentage = Math.min(usagePercentage, 100);
    const usagePercentageFormatted = Math.floor(cappedPercentage).toString();

    let severity: string;
    if (crossedThreshold >= 95) {
      severity = "Critical";
    } else if (crossedThreshold >= 90) {
      severity = "High";
    } else if (crossedThreshold >= 70) {
      severity = "Medium";
    } else {
      severity = "Info";
    }

    return {
      organizationName,
      usagePercentage,
      usagePercentageFormatted,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      crossedThreshold,
      projectUsageData,
      actionUrl,
      logoUrl,
      severity,
      ...(usageUnit !== undefined && { usageUnit }),
      ...(nextStep !== undefined && { nextStep }),
    };
  }

  /** What this organization is metered in, or nothing when the deployment composed no meter. */
  private async tryResolveUsageUnit(input: {
    organizationId: string;
  }): Promise<BillingUsageUnit | undefined> {
    if (!this.resolveUsageUnit) return undefined;
    try {
      return await this.resolveUsageUnit(input);
    } catch (error) {
      logger.warn(
        { organizationId: input.organizationId, error },
        "Could not resolve the usage unit for a usage-limit email; the mail keeps its default word",
      );

      return undefined;
    }
  }

  /**
   * Where this organization can go next, or nothing when the deployment composed no
   * catalogue, or the plan could not be read. A hook that cannot be resolved truthfully
   * is omitted rather than guessed — the service message it rides on still goes out.
   */
  private async tryResolveNextStep(input: {
    organizationId: string;
    pricingModel: BillingPricingModel | null;
    currency: "USD" | "EUR";
  }): Promise<UsageLimitEmailData["nextStep"] | undefined> {
    if (!this.nextStep) return undefined;
    try {
      return await this.nextStep.resolve(input);
    } catch (error) {
      logger.warn(
        { organizationId: input.organizationId, error },
        "Could not resolve the next-step plan for a usage-limit email; the mail omits it",
      );

      return undefined;
    }
  }

  /**
   * Sends usage limit emails to all deliverable admins, tracking successes and failures.
   */
  private async dispatchEmails({
    organizationId,
    organizationName,
    deliverableAdmins,
    emailContext,
  }: {
    organizationId: string;
    organizationName: string;
    deliverableAdmins: Array<{ user: { id: string; email: string | null } }>;
    emailContext: UsageLimitEmailData;
  }) {
    const emailResults = await Promise.allSettled(
      deliverableAdmins.map(async (member) => {
        await this.emails.sendUsageLimitEmail({
          to: member.user.email!,
          orgName: organizationName,
          usageData: emailContext,
        });
      }),
    );

    let recipientsSuccessCount = 0;
    let recipientsFailureCount = 0;
    const failedRecipients: Array<{ userId: string; error: string }> = [];

    emailResults.forEach((result, index) => {
      const member = deliverableAdmins[index];
      if (!member) {
        logger.warn({ index, organizationId }, "Member not found at index, skipping");

        return;
      }

      if (result.status === "fulfilled") {
        recipientsSuccessCount++;
      } else {
        recipientsFailureCount++;
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        failedRecipients.push({
          userId: member.user.id,
          error: errorMessage,
        });
        logger.error(
          {
            userId: member.user.id,
            error: errorMessage,
            organizationId,
          },
          "Failed to send usage limit warning email",
        );
      }
    });

    return { recipientsSuccessCount, recipientsFailureCount, failedRecipients };
  }

  /**
   * Creates a notification record through the canonical Notification service
   * after successful email delivery.
   */
  private async recordNotification({
    organizationId,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    usagePercentage,
    crossedThreshold,
    deliverableAdminsCount,
    recipientsSuccessCount,
    recipientsFailureCount,
    failedRecipients,
  }: {
    organizationId: string;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    usagePercentage: number;
    crossedThreshold: number;
    deliverableAdminsCount: number;
    recipientsSuccessCount: number;
    recipientsFailureCount: number;
    failedRecipients: Array<{ userId: string; error: string }>;
  }): Promise<Notification> {
    return this.records.create({
      organizationId,
      sentAt: new Date(),
      metadata: {
        type: NOTIFICATION_TYPES.USAGE_LIMIT_WARNING,
        currentUsage: currentMonthMessagesCount,
        limit: maxMonthlyUsageLimit,
        percentage: usagePercentage,
        threshold: crossedThreshold,
        recipientsCount: deliverableAdminsCount,
        recipientsSuccessCount,
        recipientsFailureCount,
        ...(recipientsFailureCount > 0 && {
          failedRecipients: failedRecipients.map((f) => ({
            userId: f.userId,
            error: f.error,
          })),
        }),
      },
    });
  }
}
