import { getFreePlanLimits } from "@langwatch/enterprise-billing-contract";
import {
  applyPlanTypeEntitlements,
  UNLIMITED_PLAN,
} from "@langwatch/enterprise-licensing-contract";
import type {
  EntitlementSource,
  Plan,
  PlanEnricher,
  ResolvePlanInput,
} from "@langwatch/entitlement-contract";
import type { BillingSubscriptionRepository } from "../ports/subscription.port";
import { SaaSPlanProviderService } from "./plan-provider.service";

/** What a deployment's plan sources are decided from. */
export type DeploymentPlanSourcesOptions = Readonly<{
  /**
   * Whether this is the hosted deployment.
   */
  isSaas: boolean;
  /**
   * The signed licence this deployment resolves through, where one is composed.
   */
  license?: EntitlementSource;
  /**
   * The Stripe subscription rows a hosted paid plan is read from.
   */
  subscriptions?: BillingSubscriptionRepository;
  /**
   * The operator allow-list, for the ONE thing the subscription source does with it: an
   * impersonating staff member sees the organization's real limitations rather than the
   * override.
   */
  adminEmails?: readonly string[];
}>;

/** The plan sources a process resolves every allowance through. */
export type DeploymentPlanSources = Readonly<{
  /** The plan an organization is on before any paid source lifts it. */
  baseline: Plan;
  /**
   * The signed licence, consulted FIRST, where one could be read.
   */
  license?: EntitlementSource;
  /** The paid source consulted before the baseline, where one could be read. */
  subscription?: EntitlementSource;
  /**
   * The tier entitlements applied over whichever leg answered, where a licence leg exists to
   * need them.
   */
  enrichers?: readonly PlanEnricher[];
}>;

/**
 * Which plan sources this deployment resolves through — the whole policy, once.
 */
export class DeploymentPlanSourcesService {
  private constructor(private readonly options: DeploymentPlanSourcesOptions) {}

  static create(options: DeploymentPlanSourcesOptions): DeploymentPlanSourcesService {
    return new DeploymentPlanSourcesService(options);
  }

  sources(): DeploymentPlanSources {
    const { options } = this;
    const baseline = options.isSaas ? getFreePlanLimits() : UNLIMITED_PLAN;
    // The enricher travels WITH the licence and only with it, because that is
    // the one leg whose plan can leave a tier entitlement unanswered.
    const license = options.license
      ? { license: options.license, enrichers: [{ enrich: applyPlanTypeEntitlements }] }
      : {};
    if (!options.subscriptions) {
      return { baseline, ...license };
    }

    return {
      baseline,
      ...license,
      subscription: SubscriptionEntitlementSource.create({
        subscriptions: options.subscriptions,
        isSaas: options.isSaas,
        adminEmails: options.adminEmails ?? [],
      }),
    };
  }
}

/**
 * The hosted deployment's paid plan, as Entitlements' neutral source port.
 */
class SubscriptionEntitlementSource implements EntitlementSource {
  static create(options: {
    subscriptions: BillingSubscriptionRepository;
    isSaas: boolean;
    adminEmails: readonly string[];
  }): SubscriptionEntitlementSource {
    return new SubscriptionEntitlementSource(
      SaaSPlanProviderService.create({
        subscriptions: options.subscriptions,
        isSaas: options.isSaas,
        adminEmails: options.adminEmails,
      }),
    );
  }

  private constructor(private readonly plans: SaaSPlanProviderService) {}

  async resolve(input: ResolvePlanInput): Promise<Plan> {
    return this.plans.getActivePlan(input.organizationId, input.user);
  }
}
