import {
  DeploymentPlanSourcesService,
  type BillingSubscriptionRepository,
} from "@langwatch/enterprise-billing-server";
import {
  LicensingEntitlementSourceAdapter,
  NodeLicenseCryptographyAdapter,
  type OrganizationLicensePort,
} from "@langwatch/enterprise-licensing-server";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { EntitlementService } from "@langwatch/entitlement-server";
import type { Logger } from "@langwatch/observability";

/** What this process's plan provider is composed from. */
export type WorkerPlanProviderOptions = Readonly<{
  /**
   * Whether this is the hosted deployment. It picks the BASELINE, and the two baselines are
   * opposites: hosted starts every organization on the free plan's limits and lifts them with a
   * paid source, self-hosted starts unlimited and only a licence narrows what is switched on.
   */
  isSaas: boolean;
  /**
   * Where an organization's activated licence key is read from. Absent exactly when this graph
   * opened no typed Prisma client.
   */
  licenses?: OrganizationLicensePort;
  /**
   * The public key a licence signature is checked against, where the operator rotated it. The SAME
   * variable the interactive process reads. Two processes checking a signature against different
   * keys is one deployment with two answers to whether it is licensed at all.
   */
  licensePublicKey?: string;
  /**
   * The Stripe subscription rows a hosted paid plan is read from. Absent exactly when this graph
   * opened no typed Prisma client. Absent on a HOSTED deployment, every organization resolves free
   * — including ones that are paying — which is why it is reported rather than inferred.
   */
  subscriptions?: BillingSubscriptionRepository;
  /** Where the absent plan sources are written down. */
  report?: WorkerEntitlementAbsenceReportPort;
}>;

/**
 * Which plan sources this process could not compose, said once at composition.
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
 * Which plan an organization is on, decided the way the interactive process decides it.
 */
export function createWorkerPlanProvider(options: WorkerPlanProviderOptions): PlanProvider {
  // Built here rather than inside the shared policy: verification lives in the
  // Licensing feature, and a feature package may not import another feature's
  // implementation — the same boundary that keeps `EntitlementService.create`
  // at this root. `forDeployment` is one call, so the mode it derives from
  // `isSaas` is decided once for both processes rather than twice.
  const license = options.licenses
    ? LicensingEntitlementSourceAdapter.forDeployment({
        licenses: options.licenses,
        cryptography: NodeLicenseCryptographyAdapter.create(
          options.licensePublicKey ? { publicKey: options.licensePublicKey } : {},
        ),
        isSaas: options.isSaas,
      })
    : undefined;
  if (!license) options.report?.absent("licence");

  const sources = DeploymentPlanSourcesService.create({
    isSaas: options.isSaas,
    ...(license ? { license } : {}),
    ...(options.subscriptions ? { subscriptions: options.subscriptions } : {}),
  }).sources();
  if (options.isSaas && !sources.subscription) options.report?.absent("subscription");

  return EntitlementService.create(sources);
}
