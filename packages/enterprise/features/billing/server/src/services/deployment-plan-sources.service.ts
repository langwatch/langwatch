import { getFreePlanLimits } from "@langwatch/enterprise-billing-contract";
import { UNLIMITED_PLAN } from "@langwatch/enterprise-licensing-contract";
import type { EntitlementSource, Plan, ResolvePlanInput } from "@langwatch/entitlement-contract";
import type { BillingSubscriptionRepository } from "../ports/subscription.port";
import { SaaSPlanProviderService } from "./plan-provider.service";

/** What a deployment's plan sources are decided from. */
export type DeploymentPlanSourcesOptions = Readonly<{
  /**
   * Whether this is the hosted deployment.
   *
   * It picks the BASELINE, and the two baselines are opposites: hosted starts
   * every organization on the free plan's limits and lifts them with a paid
   * source, self-hosted starts unlimited and only a licence narrows what is
   * switched on. It is configuration on both processes, read from the same
   * `IS_SAAS`, because a process that answered differently would enforce a
   * ceiling the screen does not show and gate a feature the screen offers.
   */
  isSaas: boolean;
  /**
   * The Stripe subscription rows a hosted paid plan is read from.
   *
   * Absent exactly when the calling process opened no typed Prisma client.
   * Absent on a HOSTED deployment, every organization resolves free —
   * including ones that are paying — which is why the caller reports it rather
   * than inferring it: this function returns no subscription source, and that
   * is the fact each process names in its own words.
   */
  subscriptions?: BillingSubscriptionRepository;
  /**
   * The operator allow-list, for the ONE thing the subscription source does
   * with it: an impersonating staff member sees the organization's real
   * limitations rather than the override. A process whose call sites supply no
   * user at all passes none, and gets the same answer either way.
   */
  adminEmails?: readonly string[];
}>;

/** The plan sources a process resolves every allowance through. */
export type DeploymentPlanSources = Readonly<{
  /** The plan an organization is on before any paid source lifts it. */
  baseline: Plan;
  /** The paid source consulted before the baseline, where one could be read. */
  subscription?: EntitlementSource;
}>;

/**
 * Which plan sources this deployment resolves through — the whole policy, once.
 *
 * Both processes that resolve a plan read this: `composeApiPlanProvider`
 * (`apps/api/src/app/api-usage.composition.ts`) and
 * `createWorkerPlanProvider` (`apps/worker/src/app/worker-plan-provider.composition.ts`).
 * It was written out in both until this function existed, held together only
 * by two suites asserting the same fixtures, and a background process that
 * drifted from the interactive one would stop delivering a paid feature to
 * someone being billed for it, or hand away one that was sold.
 *
 * **It returns the sources, not the provider.** `EntitlementService` belongs to
 * the core Entitlements feature, and a feature package may not import another
 * feature's implementation — only its contract — so the one line that
 * constructs the service stays at each root. What the roots no longer decide
 * is which baseline, which paid source, and what the source is built from.
 *
 * **The tier enricher is deliberately not here.** `applyPlanTypeEntitlements`
 * fills a tier's entitlement only where the resolved plan left it undefined,
 * and every plan these two sources can answer already carries the one
 * entitlement the tier map names: the baselines are `FREE` and `OPEN_SOURCE`,
 * which the map does not mention, and the subscription source answers a plan
 * out of `PLAN_LIMITS`, where `ENTERPRISE` sets `webhookEndpointsEnabled`
 * itself. Threading the enricher through these two processes changed no
 * answer. Where it does change one is the LICENCE leg — a contract signed
 * before a flag existed — and that leg applies it in
 * `PlanProviderService` (`@langwatch/enterprise-licensing-server`), which is
 * the provider a licensed deployment resolves through. The unit test beside
 * this module walks the tier map against what these sources actually answer,
 * so a NEW tier entitlement that the plan table does not carry fails here
 * rather than reaching a customer as a feature one process offers and the
 * other refuses.
 *
 * Prisma is nowhere in this module: the subscription rows arrive as the
 * repository port the calling process already composed.
 */
export function deploymentPlanSources(
  options: DeploymentPlanSourcesOptions,
): DeploymentPlanSources {
  const baseline = options.isSaas ? getFreePlanLimits() : UNLIMITED_PLAN;
  if (!options.subscriptions) return { baseline };

  return {
    baseline,
    subscription: SubscriptionEntitlementSource.create({
      subscriptions: options.subscriptions,
      isSaas: options.isSaas,
      adminEmails: options.adminEmails ?? [],
    }),
  };
}

/**
 * The hosted deployment's paid plan, as Entitlements' neutral source port.
 *
 * `SaaSPlanProviderService` answers the FREE baseline rather than null when an
 * organization has no subscription row, and `EntitlementService` already
 * discards a free plan before falling through to its own baseline. So the
 * translation is the identity one and the two baselines cannot disagree — on a
 * self-hosted deployment that does hold subscription rows included, where the
 * source answers the hosted free plan and the unlimited baseline still wins.
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
