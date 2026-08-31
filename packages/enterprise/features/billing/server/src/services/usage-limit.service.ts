import { createLogger } from "@langwatch/observability";
import type {
  BillingPlanResolver,
  BillingUsageCounter,
  BillingUsageLimitOrganization,
  PlanLimitNotifierInput,
  ResourceLimitNotifierInput,
  UsageLimitData,
} from "@langwatch/enterprise-billing-contract";
import {
  NotificationService as NotificationRecordService,
  type Notification,
} from "@langwatch/notification-contract";
import { NotificationService } from "./notification.service";
import { UsageWarningService } from "./usage-warning.service";
import type { BillingErrorReporter } from "../ports/error-reporter.port";
import {
  MIN_DAYS_BETWEEN_ALERTS,
  planLimitCooldown,
  planLimitInFlight,
  resourceLimitCooldown,
} from "../adapters/memory.cooldown-cache.adapter";
import { NullNotificationRecordAdapter } from "../adapters/null-notification-record.adapter";

const logger = createLogger("langwatch:notifications:usageLimit");

const USAGE_UNIT_DISPLAY_LABELS = {
  traces: "Monthly Traces",
  events: "Monthly Events",
} as const;
const LIMIT_TYPE_DISPLAY_LABELS = {
  members: "Team Members",
  membersLite: "Lite Members",
} as const;

/**
 * Service layer for usage limit notification business logic.
 * Single Responsibility: Handle business logic for WHEN/WHAT to send.
 *
 * Delegates delivery to {@link NotificationService} (HOW to send).
 * Framework-agnostic - no tRPC dependencies.
 */
export class UsageLimitService {
  private readonly notificationRecords: NotificationRecordService;
  private readonly organizationService: BillingUsageLimitOrganization;
  private readonly usageService: BillingUsageCounter;
  private readonly notificationService: NotificationService;
  private readonly planProvider: BillingPlanResolver;
  private readonly errorReporter: BillingErrorReporter;
  private readonly resourceCooldown: BillingCooldownCache;
  private readonly planCooldown: BillingCooldownCache;
  private readonly isSaas: boolean;
  private readonly baseHost: string;
  private readonly warnings: UsageWarningService;

  private constructor({
    notificationRecords,
    organizationService,
    usageService,
    notificationService,
    planProvider,
    errorReporter,
    resourceCooldown,
    planCooldown,
    isSaas,
    baseHost,
  }: {
    notificationRecords: NotificationRecordService;
    organizationService: BillingUsageLimitOrganization;
    usageService: BillingUsageCounter;
    notificationService: NotificationService;
    planProvider: BillingPlanResolver;
    errorReporter?: BillingErrorReporter;
    resourceCooldown?: BillingCooldownCache;
    planCooldown?: BillingCooldownCache;
    isSaas: boolean;
    baseHost: string;
  }) {
    this.notificationRecords = notificationRecords;
    this.organizationService = organizationService;
    this.usageService = usageService;
    this.notificationService = notificationService;
    this.planProvider = planProvider;
    this.errorReporter = errorReporter ?? { capture: () => {} };
    this.resourceCooldown = resourceCooldown ?? resourceLimitCooldown;
    this.planCooldown = planCooldown ?? planLimitCooldown;
    this.isSaas = isSaas;
    this.baseHost = baseHost;
    this.warnings = new UsageWarningService({
      records: notificationRecords,
      organizations: organizationService,
      usageCounts: usageService,
      emails: notificationService,
      baseHost,
    });
  }

  /**
   * Static factory method for creating a UsageLimitService with proper DI.
   */
  static create({
    notificationRecords,
    organizationService,
    usageService,
    notificationService,
    planProvider,
    isSaas = false,
    baseHost = "https://app.langwatch.ai",
    errorReporter,
    resourceCooldown,
    planCooldown,
  }: {
    notificationRecords: NotificationRecordService;
    organizationService: BillingUsageLimitOrganization;
    usageService: BillingUsageCounter;
    notificationService: NotificationService;
    planProvider: BillingPlanResolver;
    isSaas?: boolean;
    baseHost?: string;
    errorReporter?: BillingErrorReporter;
    resourceCooldown?: BillingCooldownCache;
    planCooldown?: BillingCooldownCache;
  }): UsageLimitService {
    return new UsageLimitService({
      notificationRecords,
      organizationService,
      usageService,
      notificationService,
      planProvider,
      isSaas,
      baseHost,
      errorReporter,
      resourceCooldown,
      planCooldown,
    });
  }

  /**
   * Null-object factory: every method is a silent noop.
   * Use in tests or non-SaaS deployments where no notifications are needed.
   */
  static createNull(): UsageLimitService {
    const noopRecords = new NullNotificationRecordAdapter();
    const noopOrg: BillingUsageLimitOrganization = {
      findWithAdmins: async () => null,
      updateSentPlanLimitAlert: async () => {},
      findProjectsWithName: async () => [],
    };
    const noopUsage: BillingUsageCounter = {
      getCountByProjects: async () => [],
    };
    const noopPlan: BillingPlanResolver = {
      getActivePlan: async () => ({ name: "free" }),
    };
    return new UsageLimitService({
      notificationRecords: noopRecords,
      organizationService: noopOrg,
      usageService: noopUsage,
      notificationService: NotificationService.createNull(),
      planProvider: noopPlan,
      isSaas: false,
      baseHost: "https://app.langwatch.ai",
    });
  }

  /**
   * Notifies internal channels that an organization has reached its plan limit.
   * Absorbed from planLimitNotifier.ts.
   *
   * Checks IS_SAAS env, fetches org with admin members, enforces 30-day cooldown,
   * then delegates to NotificationService for Slack and Hubspot delivery.
   */
  async notifyPlanLimitReached({
    organizationId,
    planName,
    usageUnit,
    current,
    max,
  }: PlanLimitNotifierInput): Promise<void> {
    if (!this.isSaas) {
      return;
    }

    // Synchronous guard: blocks same-tick concurrent calls (e.g. 5 trace
    // requests hitting Promise.all) before any await yields execution.
    if (planLimitInFlight.has(organizationId)) {
      return;
    }
    planLimitInFlight.add(organizationId);

    try {
      // Atomic cross-pod guard: SET NX EX claims the cooldown slot in a
      // single Redis round-trip, closing the distributed TOCTOU window.
      const claimed = await (this.planCooldown.claim?.(organizationId, true) ?? false);
      if (!claimed) {
        return;
      }

      const organization = await this.organizationService.findWithAdmins(organizationId);

      if (!organization) {
        await this.planCooldown.delete(organizationId);
        return;
      }

      if (organization.sentPlanLimitAlert) {
        const timeSinceLastAlert = Date.now() - organization.sentPlanLimitAlert.getTime();
        const daysSinceLastAlert = Math.floor(timeSinceLastAlert / (1000 * 60 * 60 * 24));

        if (daysSinceLastAlert < MIN_DAYS_BETWEEN_ALERTS) {
          return;
        }
      }

      const admin = organization.members[0]?.user;

      const context = {
        organizationId,
        organizationName: organization.name,
        adminName: admin?.name ?? undefined,
        adminEmail: admin?.email ?? undefined,
        planName,
        limitType: USAGE_UNIT_DISPLAY_LABELS[usageUnit],
        current,
        max,
      };

      // Both sends are fire-and-forget (errors swallowed internally),
      // so use allSettled to await completion without short-circuiting.
      await Promise.allSettled([
        this.notificationService.sendSlackPlanLimitAlert(context),
        this.notificationService.sendHubspotPlanLimitForm(context),
      ]);

      try {
        await this.organizationService.updateSentPlanLimitAlert(organizationId, new Date());
      } catch (error) {
        this.errorReporter.capture(
          new Error(
            `Critical: plan limit notification sent but DB timestamp update failed for org ${organizationId} on plan ${planName}`,
            { cause: error },
          ),
        );
      }
    } finally {
      planLimitInFlight.delete(organizationId);
    }
  }

  /**
   * Notifies internal channels that an organization has reached a resource limit.
   *
   * Uses an in-memory 24-hour cooldown keyed by organizationId:limitType to avoid
   * duplicate Slack alerts. Each limit type has its own cooldown window.
   */
  async notifyResourceLimitReached({
    organizationId,
    limitType,
    current,
    max,
  }: ResourceLimitNotifierInput): Promise<void> {
    if (!this.isSaas) {
      return;
    }

    const cooldownKey = `${organizationId}:${limitType}`;

    if (await this.resourceCooldown.get(cooldownKey)) {
      return;
    }

    await this.resourceCooldown.set(cooldownKey, true);

    try {
      const org = await this.organizationService.findWithAdmins(organizationId);

      if (!org) {
        await this.resourceCooldown.delete(cooldownKey);
        return;
      }

      const admin = org.members[0]?.user;
      const limitLabel = LIMIT_TYPE_DISPLAY_LABELS[limitType];

      let planName = "unknown";
      try {
        planName = (await this.planProvider.getActivePlan({ organizationId })).name ?? "unknown";
      } catch {
        // fall through with "unknown"
      }

      await this.notificationService.sendSlackResourceLimitAlert({
        organizationId,
        organizationName: org.name,
        adminName: admin?.name ?? undefined,
        adminEmail: admin?.email ?? undefined,
        planName,
        limitType: limitLabel,
        current,
        max,
      });
    } catch (error) {
      // A silent catch here lost the whole "a customer hit a resource limit"
      // signal whenever Slack was down — no log, no capture, just a released
      // cooldown. Report it the way the sibling plan-limit path does, then
      // release so the next attempt is allowed through.
      logger.error(
        { error, organizationId, limitType },
        "[billing] Failed to send resource limit alert",
      );
      this.errorReporter.capture(error instanceof Error ? error : new Error(String(error)));
      await this.resourceCooldown.delete(cooldownKey);
    }
  }

  /**
   * Emails the customer's admins when they are approaching their monthly
   * allowance. Owned by {@link UsageWarningService}; it stays on this class
   * because this is the entry point every caller already holds.
   */
  checkAndSendWarning(data: UsageLimitData): Promise<Notification | null> {
    return this.warnings.checkAndSendWarning(data);
  }
}
