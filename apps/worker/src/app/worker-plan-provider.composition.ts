import { getFreePlanLimits } from "@langwatch/enterprise-billing-contract";
import {
  SaaSPlanProviderService,
  type BillingSubscriptionRepository,
} from "@langwatch/enterprise-billing-server";
import {
  applyPlanTypeEntitlements,
  UNLIMITED_PLAN,
} from "@langwatch/enterprise-licensing-contract";
import type {
  EntitlementSource,
  Plan,
  PlanProvider,
  ResolvePlanInput,
} from "@langwatch/entitlement-contract";
import { EntitlementService } from "@langwatch/entitlement-server";
import type { Logger } from "@langwatch/observability";

/** What this process's plan provider is composed from. */
export type WorkerPlanProviderOptions = Readonly<{
  /**
   * Whether this is the hosted deployment.
   *
   * It picks the BASELINE, and the two baselines are opposites: hosted starts
   * every organization on the free plan's limits and lifts them with a paid
   * source, self-hosted starts unlimited and only a licence narrows what is
   * switched on. It is `IS_SAAS`, the same variable the interactive process
   * reads, because a background process that answered differently would enforce
   * a ceiling the screen does not show and gate a feature the screen offers.
   */
  isSaas: boolean;
  /**
   * The Stripe subscription rows a hosted paid plan is read from.
   *
   * Absent exactly when this graph opened no typed Prisma client. Absent on a
   * HOSTED deployment, every organization resolves free — including ones that
   * are paying — which is why it is reported rather than inferred.
   */
  subscriptions?: BillingSubscriptionRepository;
  /** Where the absent plan sources are written down. */
  report?: WorkerEntitlementAbsenceReportPort;
}>;

/**
 * Which plan sources this process could not compose, said once at composition.
 *
 * The two names are the interactive process's own, because the pair is one
 * fleet fact: a deployment reading a paid plan through one process and the free
 * baseline through the other bills a customer for a feature the background half
 * refuses to deliver.
 */
export abstract class WorkerEntitlementAbsenceReportPort {
  abstract absent(source: "licence" | "subscription"): void;
}

/** Writes each absent plan source to the process log, with what it costs. */
export class LoggedWorkerEntitlementAbsence extends WorkerEntitlementAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerEntitlementAbsence {
    return new LoggedWorkerEntitlementAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(source: "licence" | "subscription"): void {
    this.logger.warn({ source }, ENTITLEMENT_CONSEQUENCE[source]);
  }
}

const ENTITLEMENT_CONSEQUENCE = {
  licence:
    "worker composed no licence source: a signed licence is not read here, so every organization resolves the deployment's baseline plan and only the tier entitlements carried by the plan's own type are applied.",
  subscription:
    "worker composed no subscription source on a HOSTED deployment: every organization resolves the free baseline, including ones that are paying, so their webhooks stop being delivered and their automations settle against the free daily ceiling.",
} as const;

/**
 * Which plan an organization is on, decided the way the interactive process
 * decides it.
 *
 * Three consumers in this process read it and all three are customer-visible in
 * a way a wrong answer hides: the webhook delivery gate (a paid feature either
 * delivered to someone who did not buy it or silently stopped for someone who
 * did), the automation persist ceiling, and the trace record's visibility
 * window. So this is not a convenience default — it resolves from the
 * subscription rows, or it says which source it could not read.
 *
 * **The policy line is written twice in the tree.** `baseline: isSaas ?
 * getFreePlanLimits() : UNLIMITED_PLAN`, the subscription source over it and
 * the one tier enricher are also `composeApiPlanProvider`'s
 * (`apps/api/src/app/api-usage.composition.ts`), and the two cannot be one
 * function today: it lives inside the interactive application, which a
 * background process must not import, and hoisting it into a package would put
 * the enterprise billing and licensing tiers on a feature package that does not
 * carry them. What holds the two together meanwhile is a test, not a type —
 * `worker-plan-provider.composition.unit.test.ts` asserts the same resolutions
 * `api-usage.composition.unit.test.ts` asserts, on the same fixtures. The
 * follow-up that removes the copy is a `deploymentBaselinePlan({ isSaas })` in
 * `@langwatch/enterprise-licensing-contract`, which already owns one of the two
 * baselines and is a contract package both roots may depend on.
 *
 * The tier enricher is carried because the interactive process carries it, not
 * because it fires: `applyPlanTypeEntitlements` fills a tier's entitlement only
 * where the resolved plan left it undefined, and the one field it maps —
 * `webhookEndpointsEnabled` on `ENTERPRISE` — is already set by that plan's own
 * limits. It is the seam a NEW tier entitlement lands on, and it must land on
 * both roots at once or one process starts refusing what the other offers.
 *
 * `adminEmails` is deliberately NOT passed. It feeds exactly one field —
 * `overrideAddingLimitations`, for an operator impersonating a member — and no
 * call site in this process supplies a user at all, so a list threaded here
 * would be a collaborator nothing can reach.
 */
export function createWorkerPlanProvider(options: WorkerPlanProviderOptions): PlanProvider {
  options.report?.absent("licence");

  const subscription = options.subscriptions
    ? WorkerSubscriptionEntitlementSource.create({
        subscriptions: options.subscriptions,
        isSaas: options.isSaas,
      })
    : undefined;
  if (options.isSaas && !subscription) options.report?.absent("subscription");

  return EntitlementService.create({
    baseline: options.isSaas ? getFreePlanLimits() : UNLIMITED_PLAN,
    ...(subscription ? { subscription } : {}),
    enrichers: [{ enrich: applyPlanTypeEntitlements }],
  });
}

/**
 * The hosted deployment's paid plan, as Entitlements' neutral source port.
 *
 * `SaaSPlanProviderService` answers the FREE baseline rather than null when an
 * organization has no subscription row, and `EntitlementService` already
 * discards a free plan before falling through to its own baseline. So the
 * translation is the identity one and the two baselines cannot disagree.
 */
class WorkerSubscriptionEntitlementSource implements EntitlementSource {
  static create(options: {
    subscriptions: BillingSubscriptionRepository;
    isSaas: boolean;
  }): WorkerSubscriptionEntitlementSource {
    return new WorkerSubscriptionEntitlementSource(
      SaaSPlanProviderService.create({
        subscriptions: options.subscriptions,
        isSaas: options.isSaas,
      }),
    );
  }

  private constructor(private readonly plans: SaaSPlanProviderService) {}

  async resolve(input: ResolvePlanInput): Promise<Plan> {
    return this.plans.getActivePlan(input.organizationId, input.user);
  }
}
