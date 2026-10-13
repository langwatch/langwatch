// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  BillingUsageLimitOrganization,
  ResourceLimitNotifierInput,
} from "@langwatch/enterprise-billing-contract";
import { LIMIT_TYPE_DISPLAY_LABELS } from "@langwatch/enterprise-licensing-contract";
import { createLogger } from "@langwatch/observability";

import type { BillingCooldownCache } from "./billing-alert-cooldown.service.ts";
import type { BillingErrorReporter } from "./billing-error-reporter.service.ts";
import type { NotificationService } from "./billing-usage-notice.service.ts";
import type { SaaSPlanProviderService } from "./plan-provider.service.ts";

const logger = createLogger("langwatch:billing:resourceLimitAlert");

type ResourceLimitAlertDependencies = Readonly<{
  isSaas: boolean;
  /** Main's per-process 24h damper, keyed by organization and limit. */
  cooldown: BillingCooldownCache;
  organizations: Pick<BillingUsageLimitOrganization, "findWithAdmins">;
  plans: Pick<SaaSPlanProviderService, "getActivePlan">;
  notices: Pick<NotificationService, "sendSlackResourceLimitAlert">;
  errors: BillingErrorReporter;
}>;

/** Main's `usageLimits.notifyResourceLimitReached`: the ops Slack alert for a reached seat limit. */
export class ResourceLimitAlertService {
  static create(dependencies: ResourceLimitAlertDependencies): ResourceLimitAlertService {
    return new ResourceLimitAlertService(dependencies);
  }

  private constructor(private readonly dependencies: ResourceLimitAlertDependencies) {}

  async notifyResourceLimitReached({
    organizationId,
    limitType,
    current,
    max,
  }: ResourceLimitNotifierInput): Promise<void> {
    const { isSaas, cooldown, organizations, plans, notices, errors } = this.dependencies;
    if (!isSaas) return;

    const cooldownKey = `${organizationId}:${limitType}`;
    if (await cooldown.find(cooldownKey)) return;
    await cooldown.set(cooldownKey, true);

    try {
      const organization = await organizations.findWithAdmins(organizationId);
      if (!organization) {
        await cooldown.delete(cooldownKey);
        return;
      }

      const admin = organization.members[0]?.user;
      const plan = await plans.getActivePlan(organizationId).catch(() => null);
      await notices.sendSlackResourceLimitAlert({
        organizationId,
        organizationName: organization.name,
        adminName: admin?.name ?? undefined,
        adminEmail: admin?.email ?? undefined,
        planName: plan?.name ?? "unknown",
        limitType: LIMIT_TYPE_DISPLAY_LABELS[limitType],
        current,
        max,
      });
    } catch (error) {
      // Reported, then released, so the next attempt is let through: as main.
      logger.error(
        { error, organizationId, limitType },
        "[billing] Failed to send resource limit alert",
      );
      errors.capture(error instanceof Error ? error : new Error(String(error)), {
        organizationId,
        limitType,
      });
      await cooldown.delete(cooldownKey);
    }
  }
}
