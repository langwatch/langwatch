import {
  deploymentPlanSources,
  type BillingSubscriptionRepository,
} from "@langwatch/enterprise-billing-server";
import {
  LicensingEntitlementSource,
  NodeLicenseCryptographyAdapter,
  type OrganizationLicensePort,
} from "@langwatch/enterprise-licensing-server";
import type { PlanProvider } from "@langwatch/entitlement-contract";
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
   * Where an organization's activated licence key is read from.
   *
   * Absent exactly when this graph opened no typed Prisma client. On a
   * self-hosted deployment the licence is the ONLY paid source there is, so a
   * background process that cannot read it withholds the Enterprise tier the
   * screen grants — the webhook batch the customer bought stops leaving while
   * the endpoint page still says it is enabled.
   */
  licenses?: OrganizationLicensePort;
  /**
   * The public key a licence signature is checked against, where the operator
   * rotated it.
   *
   * The SAME variable the interactive process reads. Two processes checking a
   * signature against different keys is one deployment with two answers to
   * whether it is licensed at all.
   */
  licensePublicKey?: string;
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
    "worker composed no licence source because it opened no database: an activated licence is not read here, so a licensed deployment resolves the same baseline an unlicensed one does and the Enterprise tier its contract names is withheld.",
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
 * **The policy itself is not written here.** Which baseline a deployment starts
 * from, which paid source is consulted over it and what that source is built
 * from come from `deploymentPlanSources`
 * (`@langwatch/enterprise-billing-server`), which the interactive process reads
 * too. It used to be written out in both roots and held together only by two
 * suites asserting the same fixtures. What is this process's own is the rest of
 * this function: the absences it names, and the entitlement service it
 * constructs around the answer — the service belongs to the core Entitlements
 * feature, which a feature package may not import.
 *
 * The tier enricher travels with the licence leg and is threaded by the shared
 * policy, not here. It fills a tier entitlement only where the resolved plan
 * left it undefined, and a signed licence is the one leg that can: a contract
 * minted before a flag existed resolves `ENTERPRISE` with that field unset,
 * which on this process is the difference between delivering a customer's
 * webhooks and dropping them. A tier entitlement the plan table does not carry
 * fails `deployment-plan-sources.unit.test.ts` rather than reaching a customer.
 *
 * `adminEmails` is deliberately NOT passed. It feeds exactly one field —
 * `overrideAddingLimitations`, for an operator impersonating a member — and no
 * call site in this process supplies a user at all, so a list threaded here
 * would be a collaborator nothing can reach.
 */
export function createWorkerPlanProvider(options: WorkerPlanProviderOptions): PlanProvider {
  // Built here rather than inside the shared policy: verification lives in the
  // Licensing feature, and a feature package may not import another feature's
  // implementation — the same boundary that keeps `EntitlementService.create`
  // at this root. `forDeployment` is one call, so the mode it derives from
  // `isSaas` is decided once for both processes rather than twice.
  const license = options.licenses
    ? LicensingEntitlementSource.forDeployment({
        licenses: options.licenses,
        cryptography: NodeLicenseCryptographyAdapter.create(
          options.licensePublicKey ? { publicKey: options.licensePublicKey } : {},
        ),
        isSaas: options.isSaas,
      })
    : undefined;
  if (!license) options.report?.absent("licence");

  const sources = deploymentPlanSources({
    isSaas: options.isSaas,
    ...(license ? { license } : {}),
    ...(options.subscriptions ? { subscriptions: options.subscriptions } : {}),
  });
  if (options.isSaas && !sources.subscription) options.report?.absent("subscription");

  return EntitlementService.create(sources);
}
