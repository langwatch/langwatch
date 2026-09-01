import { UsageLimitService as PackagedUsageLimitService } from "@langwatch/enterprise-billing-server";
import type {
  BillingPlanResolver,
  BillingUsageCounter,
  BillingUsageLimitOrganization,
  PlanLimitNotifierInput,
  ResourceLimitNotifierInput,
} from "@langwatch/enterprise-billing-contract";
import { TtlCache } from "~/server/utils/ttlCache";
import { captureException } from "~/utils/posthogErrorCapture";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import type { UsageService } from "~/server/app-layer/usage/usage.service";
import type { PlanProvider } from "~/server/app-layer/subscription/plan-provider";
import type { NotificationService } from "~/runtime/app/features/billing";
import type { NotificationService as NotificationRecordService } from "@langwatch/notification-contract";

const resourceCache = new TtlCache<true>(
  24 * 60 * 60 * 1000,
  "ttlcache:billing:limitCooldown:",
);
const planCache = new TtlCache<true>(
  30 * 24 * 60 * 60 * 1000,
  "ttlcache:billing:planLimitCooldown:",
);
const cacheAdapter = (cache: TtlCache<true>) => ({
  get: async (key: string) => (await cache.get(key)) ?? null,
  set: (key: string, value: true) => cache.set(key, value),
  delete: (key: string) => cache.delete(key),
  claim: (key: string, value: true) => cache.claim(key, value),
});

export const resourceLimitCooldown = resourceCache;
export const planLimitCooldown = planCache;
export { planLimitInFlight } from "@langwatch/enterprise-billing-server";

/** Thin app composition adapter for the packaged usage-limit workflow. */
export class UsageLimitService {
  private constructor(private readonly service: PackagedUsageLimitService) {}

  static create(options: {
    notificationRecords: NotificationRecordService;
    organizationService: OrganizationService;
    usageService: UsageService;
    notificationService: NotificationService;
    planProvider: PlanProvider;
    isSaas?: boolean;
    baseHost?: string;
  }): UsageLimitService {
    const service = PackagedUsageLimitService.create({
      notificationRecords: options.notificationRecords,
      organizationService:
        options.organizationService as unknown as BillingUsageLimitOrganization,
      usageService: options.usageService as unknown as BillingUsageCounter,
      notificationService: options.notificationService,
      planProvider: options.planProvider as unknown as BillingPlanResolver,
      isSaas: options.isSaas,
      baseHost: options.baseHost,
      resourceCooldown: cacheAdapter(resourceLimitCooldown),
      planCooldown: cacheAdapter(planLimitCooldown),
      errorReporter: {
        capture: (error, context) =>
          captureException(error, context ? { extra: context } : undefined),
      },
    });
    return new UsageLimitService(service);
  }

  static createNull(): UsageLimitService {
    return new UsageLimitService(PackagedUsageLimitService.createNull());
  }

  notifyPlanLimitReached(input: PlanLimitNotifierInput) {
    return this.service.notifyPlanLimitReached(input);
  }

  notifyResourceLimitReached(input: ResourceLimitNotifierInput) {
    return this.service.notifyResourceLimitReached(input);
  }

  checkAndSendWarning(
    input: Parameters<PackagedUsageLimitService["checkAndSendWarning"]>[0],
  ) {
    return this.service.checkAndSendWarning(input);
  }
}
