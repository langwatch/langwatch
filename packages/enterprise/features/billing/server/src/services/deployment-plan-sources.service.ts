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
   * The signed licence this deployment resolves through, where one is composed.
   *
   * It arrives BUILT rather than as the licence store, because verification
   * lives in `@langwatch/enterprise-licensing-server` and a feature package may
   * not import another feature's implementation — the same boundary that keeps
   * `EntitlementService` itself at each root. `LicensingEntitlementSource.forDeployment`
   * is the one call that builds it, so the deployment mode it reads is derived
   * once rather than at each process.
   *
   * Absent exactly when the calling process opened no typed Prisma client.
   * Absent, a licensed self-hosted deployment resolves the same unlimited
   * baseline an unlicensed one does — it keeps every allowance, and loses the
   * Enterprise tier the licence names — which is why the caller reports it.
   */
  license?: EntitlementSource;
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
  /**
   * The signed licence, consulted FIRST, where one could be read.
   *
   * First because a licence is the negotiated contract: on the hosted
   * deployment it is meant to override whatever the subscription says, and on
   * a self-hosted one it is the only paid source there is.
   */
  license?: EntitlementSource;
  /** The paid source consulted before the baseline, where one could be read. */
  subscription?: EntitlementSource;
  /**
   * The tier entitlements applied over whichever leg answered, where a licence
   * leg exists to need them.
   *
   * On the baseline and subscription legs this changes nothing — the baselines
   * are `FREE` and `OPEN_SOURCE`, which the tier map does not name, and a
   * subscription answers a plan out of `PLAN_LIMITS`, where `ENTERPRISE`
   * already carries the one field the map fills. The LICENCE leg is the one
   * that needs it: a licence signed before a flag existed resolves `ENTERPRISE`
   * with that field `undefined`, and without this the deployment that bought
   * the tier is refused the feature the tier sells.
   */
  enrichers?: readonly PlanEnricher[];
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
 * **The tier enricher travels with the licence, and only with it.**
 * `applyPlanTypeEntitlements` fills a tier's entitlement only where the
 * resolved plan left it undefined, and every plan the OTHER two legs can answer
 * already carries the one entitlement the tier map names: the baselines are
 * `FREE` and `OPEN_SOURCE`, which the map does not mention, and the
 * subscription source answers a plan out of `PLAN_LIMITS`, where `ENTERPRISE`
 * sets `webhookEndpointsEnabled` itself. A signed licence is the leg that can
 * leave it unanswered — `resolvePlanDefaults` deliberately does not default the
 * field, so a contract minted before the flag existed resolves `ENTERPRISE`
 * with it `undefined` — which is why a deployment that composed a licence
 * source gets the enricher and one that did not is left unchanged. The unit
 * test beside this module walks the tier map against what these sources
 * actually answer, so a NEW tier entitlement that the plan table does not carry
 * fails here rather than reaching a customer as a feature one process offers
 * and the other refuses.
 *
 * Prisma is nowhere in this module: the subscription rows arrive as the
 * repository port the calling process already composed.
 */
export function deploymentPlanSources(
  options: DeploymentPlanSourcesOptions,
): DeploymentPlanSources {
  const baseline = options.isSaas ? getFreePlanLimits() : UNLIMITED_PLAN;
  // The enricher travels WITH the licence and only with it, because that is
  // the one leg whose plan can leave a tier entitlement unanswered.
  const license = options.license
    ? { license: options.license, enrichers: [{ enrich: applyPlanTypeEntitlements }] }
    : {};
  if (!options.subscriptions) return { baseline, ...license };

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
