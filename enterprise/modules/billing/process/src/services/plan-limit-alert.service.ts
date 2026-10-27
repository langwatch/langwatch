// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  BillingUsageLimitOrganization,
  PlanLimitNotifierInput,
} from "@langwatch/enterprise-billing-contract";
import { USAGE_UNIT_DISPLAY_LABELS } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { MIN_DAYS_BETWEEN_ALERTS } from "./billing-alert-cooldown.service.ts";
import type { BillingErrorReporter } from "./billing-error-reporter.service.ts";
import type { NotificationService } from "./billing-usage-notice.service.ts";

const logger = createLogger("langwatch:billing:planLimitAlert");

const DAY_MS = 24 * 60 * 60 * 1000;

type PlanLimitAlertDependencies = Readonly<{
  isSaas: boolean;
  /** Main's synchronous guard: callers interleaving within one tick send once. */
  inFlight: Set<string>;
  /** Main's 30-day damper in front of the organization's own timestamp. */
  cooldown: Readonly<{
    claim(key: string, value: true): Promise<boolean>;
    delete(key: string): Promise<void>;
  }>;
  organizations: Pick<BillingUsageLimitOrganization, "findWithAdmins" | "updateSentPlanLimitAlert">;
  notices: Pick<NotificationService, "sendSlackPlanLimitAlert" | "sendHubspotPlanLimitForm">;
  errors: BillingErrorReporter;
}>;

/** Main's `usageLimits.notifyPlanLimitReached`: ops Slack and HubSpot once a month per organization. */
export class PlanLimitAlertService {
  static create(dependencies: PlanLimitAlertDependencies): PlanLimitAlertService {
    return new PlanLimitAlertService(dependencies);
  }

  private constructor(private readonly dependencies: PlanLimitAlertDependencies) {}

  async notifyPlanLimitReached({
    organizationId,
    planName,
    usageUnit,
    current,
    max,
  }: PlanLimitNotifierInput): Promise<void> {
    const { isSaas, inFlight, cooldown, organizations, notices, errors } = this.dependencies;
    if (!isSaas || inFlight.has(organizationId)) return;
    inFlight.add(organizationId);

    try {
      if (!(await cooldown.claim(organizationId, true))) return;

      const organization = await organizations.findWithAdmins(organizationId);
      if (!organization) {
        await cooldown.delete(organizationId);
        return;
      }

      const now = nowInstant();
      const sent = organization.sentPlanLimitAlert;
      if (sent) {
        const days = Math.floor((now.epochMilliseconds - sent.epochMilliseconds) / DAY_MS);
        if (days < MIN_DAYS_BETWEEN_ALERTS) return;
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
      await Promise.allSettled([
        notices.sendSlackPlanLimitAlert(context),
        notices.sendHubspotPlanLimitForm(context),
      ]);

      try {
        await organizations.updateSentPlanLimitAlert(organizationId, now);
      } catch (error) {
        logger.error({ error, organizationId }, "[billing] Plan limit alert sent, timestamp not");
        errors.capture(
          new Error(
            `Critical: plan limit notification sent but DB timestamp update failed for org ${organizationId} on plan ${planName}`,
            { cause: error },
          ),
        );
      }
    } finally {
      inFlight.delete(organizationId);
    }
  }
}
