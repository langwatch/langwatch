// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingUsageLimitOrganization } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";

import type { BillingCooldownCache } from "./billing-alert-cooldown.service.ts";
import type { BillingErrorReporter } from "./billing-error-reporter.service.ts";
import type { NotificationService } from "./billing-usage-notice.service.ts";
import type { SaaSPlanProviderService } from "./plan-provider.service.ts";

const logger = createLogger("langwatch:billing:duplicateSubscriptionAlert");

/** What a seat change reports when it finds more than one active subscription. */
export type DuplicateSubscriptionReport = {
  organizationId: string;
  subscriptionIds: string[];
};

/** Where a refused seat change tells ops about an account it cannot tell apart. */
export interface DuplicateSubscriptionAlerts {
  reportDuplicateActive(report: DuplicateSubscriptionReport): Promise<void>;
}

/** For a composition that posts no Slack notices. */
export const NO_DUPLICATE_SUBSCRIPTION_ALERTS: DuplicateSubscriptionAlerts = {
  reportDuplicateActive: async () => undefined,
};

type DuplicateSubscriptionAlertDependencies = Readonly<{
  isSaas: boolean;
  /** The per-process 24h damper, keyed by organization, as the resource-limit alert's. */
  cooldown: BillingCooldownCache;
  organizations: Pick<BillingUsageLimitOrganization, "findWithAdmins">;
  plans: Pick<SaaSPlanProviderService, "getActivePlan">;
  notices: Pick<NotificationService, "sendSlackDuplicateActiveSubscriptions">;
  errors: BillingErrorReporter;
}>;

/** Ops' Slack alert, beside the resource-limit one, for an organization with two live plans. */
export class DuplicateSubscriptionAlertService implements DuplicateSubscriptionAlerts {
  static create(
    dependencies: DuplicateSubscriptionAlertDependencies,
  ): DuplicateSubscriptionAlertService {
    return new DuplicateSubscriptionAlertService(dependencies);
  }

  private constructor(private readonly dependencies: DuplicateSubscriptionAlertDependencies) {}

  /** Never throws: the refusal the customer sees must not change because the alert failed. */
  async reportDuplicateActive({
    organizationId,
    subscriptionIds,
  }: DuplicateSubscriptionReport): Promise<void> {
    const { isSaas, cooldown, organizations, plans, notices, errors } = this.dependencies;
    if (!isSaas) return;

    const cooldownKey = `duplicate-subscriptions:${organizationId}`;
    try {
      if (await cooldown.find(cooldownKey)) return;
      await cooldown.set(cooldownKey, true);

      const organization = await organizations.findWithAdmins(organizationId);
      const admin = organization?.members[0]?.user;
      const plan = await plans.getActivePlan(organizationId).catch(() => null);
      const sent = await notices.sendSlackDuplicateActiveSubscriptions({
        organizationId,
        organizationName: organization?.name ?? organizationId,
        adminName: admin?.name ?? undefined,
        adminEmail: admin?.email ?? undefined,
        planName: plan?.name ?? "unknown",
        subscriptionIds,
      });
      if (!sent) await cooldown.delete(cooldownKey);
    } catch (error) {
      logger.error(
        { error, organizationId },
        "[billing] Failed to send duplicate subscription alert",
      );
      errors.capture(error instanceof Error ? error : new Error(String(error)), { organizationId });
      await cooldown.delete(cooldownKey).catch(() => undefined);
    }
  }
}
