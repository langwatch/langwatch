import { BillingApi } from "@langwatch/enterprise-billing-contract";
import { applyPlanTypeEntitlements, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  entitlementConfig,
  EntitlementApi,
  type AuthorizationContextResolver,
  type BaselinePlanSource,
  type EntitlementApi as EntitlementApiContract,
  type EntitlementConfig,
  type EntitlementOperator,
  type EntitlementSource,
  type GetUsageInput,
  type ListOrganizationSpendInput,
  type Plan,
  type PlanEnricher,
  type PlanNextStep,
  type PlanProviderUser,
  type ProjectSpendRollup,
  type ResolvePlanInput,
  type SendUsageLimitWarningInput,
  type UsageLimitWarning,
  type UsageStats,
  type PricingModel,
  PlanLimitExceededError,
} from "@langwatch/entitlement-contract";
import type { EventingCommands, StaticPipelineDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { OrganizationApi } from "@langwatch/organization-contract";
import {
  deriveDatasetBounds,
  effectiveDatasetAttachmentMaxBytes,
  isDatasetDerivedBoundKey,
  resolveRequestBound,
  type RequestBoundKey,
  type RequestBoundsOverrides,
} from "@langwatch/plans";
import type { FeatureSetup } from "@langwatch/process";
import { nowInstant } from "@langwatch/time";

import { buildUsageWarningPipeline } from "../eventing/entitlement-usage-warning.pipeline.ts";
import { CountMonthCommand } from "../eventing/usage.commands.ts";
import {
  buildUsagePipeline,
  type UsagePipelineDefinition,
  type UsageSenders,
} from "../eventing/usage.pipeline.ts";
import type { EntitlementRepositories } from "../repositories/entitlement.repositories.ts";
import { coreBaselinePlan } from "../rules/plan-baseline.rules.ts";
import { BillableEventsMeterAppendService } from "../services/billable-events-meter-append.service.ts";
import { EntitlementService } from "../services/entitlement.service.ts";
import { PlanNextStepService } from "../services/plan-next-step.service.ts";
import { SelfServePlanCatalogueService } from "../services/self-serve-plan-catalogue.service.ts";
import { SubscriptionPlanService } from "../services/subscription-plan.service.ts";
import { TraceMeterAppendService } from "../services/trace-meter-append.service.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";
import { UsageService, type UsageCounter } from "../services/usage-enforcement.service.ts";
import { UsageStatsService } from "../services/usage-stats.service.ts";
import { UsageWarningService, type UsageWarning } from "../services/usage-warning.service.ts";

/**
 * One plan on the purchase ladder. Annual and monthly variants of one tier
 * are collapsed to the same rung.
 */
export interface CataloguePlan {
  /** The tier, monthly and annual variants collapsed onto one. */
  tier: string;
  /**
   * Every plan type that sits on this rung, the tier itself included. The
   * mapping is the catalogue's own fact: which types are billing periods of
   * one tier, and which are currency cuts, is not for a policy to guess from a name.
   */
  types: readonly string[];
  name: string;
  /** A whole monthly amount by currency, per seat when `pricedPerSeat`. */
  monthlyPrice: Readonly<Record<"USD" | "EUR", number>>;
  pricedPerSeat: boolean;
  maxMessagesPerMonth: number;
  maxMembers: number;
  /** Confirmed matches a day one automation may act on, on this rung. */
  automationDailyDispatchCeiling: number;
}

/**
 * Self-serve plans only; enterprise tiers absent by design so account-managed
 * organizations are identified by absence alone. Infrastructure, not constant,
 * because pricing model decides which rungs appear.
 */
export interface PlanCatalogueReader {
  listSelfServePlans(input: {
    pricingModel: PricingModel | null;
  }): Promise<readonly CataloguePlan[]>;
}

/** Provider-neutral sources and readings supplied by the process composition root. */
export type EntitlementInfrastructure = Readonly<{
  baseline: Plan | BaselinePlanSource;
  license?: EntitlementSource;
  subscription?: EntitlementSource;
  enrichers?: readonly PlanEnricher[];
  authorization?: AuthorizationContextResolver;
  /** The month's billable volume, counted in the deployment's analytics store. */
  counter: UsageCounter;
  /** The approaching-limit mail, over the deployment's gateway. */
  warnings: UsageWarning;
}>;

const logger = createLogger("langwatch:usage");

/** Organization stores the per-file dataset limit in MiB; the bounds are in bytes. */
const BYTES_PER_MEBIBYTE = 1024 * 1024;

/** How recent an end date has to be for the rollup to read it as "up to now". */
const RECENT_SPEND_WINDOW_MS = 1000 * 60 * 60;

type EntitlementSetup = FeatureSetup<
  typeof EntitlementModule.dependencies,
  EntitlementConfig,
  EntitlementRepositories
>;

/** What `dependencies` resolves to, for the direct-injection testing seam. */
type EntitlementDependencies = EntitlementSetup["dependencies"];

/**
 * What the constructor actually reads off `dependencies`: seats from organization, the pricing
 * model from billing. `license` is consumed once, by `create`, to build
 * {@link EntitlementInfrastructure} — a hand-built test app needs no license source.
 */
type EntitlementCallerLookup = Pick<EntitlementDependencies, "organizations" | "billing">;

/** The repositories the app reads directly; the meters reach it only through its usage pipeline. */
type EntitlementReadRepositories = Pick<
  EntitlementRepositories,
  "membership" | "spend" | "tenancy"
>;

/** The usage pipeline over the senders its process manager and subscriber call back through. */
type UsagePipelineBuild = (send: () => UsageSenders) => UsagePipelineDefinition;

/** What a plan allows, and what has been used and spent against it. */
export class EntitlementModule implements EntitlementApiContract {
  static readonly contract = EntitlementApi;
  static readonly dependencies = {
    license: LicensingApi,
    billing: BillingApi,
    organizations: OrganizationApi,
  };
  static readonly config = entitlementConfig;

  #plans: EntitlementService;
  #usage: UsageStatsService;
  #counter: UsageCounter;
  #nextStep: PlanNextStepService;
  #warnings: UsageWarning;
  #spend: EntitlementRepositories["spend"];
  #tenancy: EntitlementRepositories["tenancy"];
  #pricing: EntitlementCallerLookup["billing"];
  #requestBoundOverrides: RequestBoundsOverrides;
  #buildUsagePipeline: UsagePipelineBuild | undefined;
  #usageSenders: UsageSenders | undefined;

  private constructor({
    repositories,
    infrastructure,
    dependencies,
    config,
    usagePipeline,
  }: {
    repositories: EntitlementReadRepositories;
    infrastructure: EntitlementInfrastructure;
    dependencies: EntitlementCallerLookup;
    config: Pick<EntitlementConfig, "requestBounds">;
    usagePipeline?: UsagePipelineBuild;
  }) {
    this.#plans = EntitlementService.create(infrastructure);
    this.#usage = UsageStatsService.create({
      membership: repositories.membership,
      seats: dependencies.organizations,
      counter: infrastructure.counter,
      plans: this.#plans,
    });
    this.#counter = infrastructure.counter;
    this.#nextStep = PlanNextStepService.create({
      catalogue: SelfServePlanCatalogueService.create(),
    });
    this.#warnings = infrastructure.warnings;
    this.#spend = repositories.spend;
    this.#tenancy = repositories.tenancy;
    this.#pricing = dependencies.billing;
    this.#requestBoundOverrides = config.requestBounds ?? {};
    this.#buildUsagePipeline = usagePipeline;
  }

  static create({ repositories, dependencies, config }: EntitlementSetup): EntitlementModule {
    // Main composed the subscription provider on Cloud only; self-hosted resolves licences alone.
    const subscription = config.isSaas
      ? SubscriptionPlanService.create(dependencies.billing)
      : undefined;
    const sources = {
      baseline: subscription ?? coreBaselinePlan({ isSaas: config.isSaas }),
      license: dependencies.license,
      subscription: subscription?.asGrantSource(),
      // Main's PlanProviderService: every leg's plan gets the entitlements its tier grants.
      enrichers: [{ enrich: applyPlanTypeEntitlements }],
    };
    const plans = EntitlementService.create(sources);
    const counter = UsageService.overPeers({
      isSaas: config.isSaas,
      planResolver: (organizationId) => plans.getActivePlan({ organizationId }),
      peers: dependencies,
      tenancy: repositories.tenancy,
      meter: repositories.billableEvents,
      traceMeter: repositories.traces,
    });
    const warnings = UsageWarningService.create({
      billing: dependencies.billing,
      counter,
      plans,
      tenancy: repositories.tenancy,
      isSaas: config.isSaas,
      logger: createLogger("langwatch:entitlement:usage-warning"),
    });

    const counting = UsageCountingService.create({
      meter: repositories.billableEvents,
      traceMeter: repositories.traces,
      plans,
      billing: dependencies.billing,
    });
    // The trace meter is appended everywhere (round 22); the billable-events meter on Cloud only.
    const traceMeter = TraceMeterAppendService.create({
      meter: repositories.traces,
      projects: repositories.tenancy,
    });
    const billableEventsMeter = config.isSaas
      ? BillableEventsMeterAppendService.create({
          meter: repositories.billableEvents,
          projects: repositories.tenancy,
        })
      : undefined;

    return new EntitlementModule({
      repositories,
      infrastructure: { ...sources, counter, warnings },
      dependencies,
      config,
      usagePipeline: (send) =>
        buildUsagePipeline({
          countMonth: CountMonthCommand.create({ counting }),
          traceMeter,
          billableEventsMeter,
          projects: repositories.tenancy,
          send,
        }),
    });
  }

  /**
   * Constructs the app directly over a hand-built {@link EntitlementInfrastructure},
   * bypassing {@link buildEntitlementInfrastructure}. For tests only —
   * production always goes through `create`, exercising every collaborator the same way.
   */
  static createForTesting(setup: {
    repositories: EntitlementReadRepositories;
    infrastructure: EntitlementInfrastructure;
    dependencies: EntitlementCallerLookup;
    config?: Pick<EntitlementConfig, "requestBounds">;
  }): EntitlementModule {
    return new EntitlementModule({
      repositories: setup.repositories,
      infrastructure: setup.infrastructure,
      dependencies: setup.dependencies,
      config: { requestBounds: setup.config?.requestBounds },
    });
  }

  async getActivePlan(input: ResolvePlanInput): Promise<Plan> {
    return this.#plans.getActivePlan({
      organizationId: input.organizationId,
      user: this.#resolveCaller(input),
    });
  }

  /**
   * The deployment's bound, except that an organization with its own per-file
   * limit answers the larger of that and what its limit derives, for the
   * dataset size bounds only. See specs/dataset-bounds-override.feature.
   */
  async requestBound(input: { key: RequestBoundKey; organizationId: string }): Promise<number> {
    const deploymentBound = await this.#deploymentRequestBound(input);
    if (!isDatasetDerivedBoundKey(input.key)) return deploymentBound;

    const { attachmentMaxMb } = await this.#tenancy.getDatasetLimits({
      organizationId: input.organizationId,
    });
    if (attachmentMaxMb === null) return deploymentBound;

    const raised = deriveDatasetBounds(
      effectiveDatasetAttachmentMaxBytes(attachmentMaxMb * BYTES_PER_MEBIBYTE),
    );

    return Math.max(deploymentBound, raised[input.key]);
  }

  /**
   * A plain-number override answers on every tier without a plan lookup;
   * otherwise the active plan resolves through the same path `getActivePlan`
   * uses, and its tier's bound answers — per-tier overrides included.
   */
  async #deploymentRequestBound(input: {
    key: RequestBoundKey;
    organizationId: string;
  }): Promise<number> {
    const override = this.#requestBoundOverrides[input.key];
    if (typeof override === "number") return override;

    const plan = await this.#plans.getActivePlan({ organizationId: input.organizationId });

    return resolveRequestBound(input.key, plan.type, this.#requestBoundOverrides);
  }

  async resolvePlanNextStep(
    input: Readonly<{ plan: Plan; organizationId: string }>,
  ): Promise<PlanNextStep> {
    const [{ pricingModel }, currency] = await Promise.all([
      this.#pricing.getPricingModel({ organizationId: input.organizationId }),
      this.#tenancy.getCurrency({ organizationId: input.organizationId }),
    ]);

    return this.#nextStep.resolve({ plan: input.plan, pricingModel, currency });
  }

  async getUsage(input: GetUsageInput): Promise<UsageStats> {
    const user = this.#resolveCaller(input);

    return this.#usage.getUsageStats(input.organizationId, user);
  }

  sendUsageLimitWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning> {
    return this.#warnings.sendWarning(input);
  }

  async assertWithinUsageLimit(input: { organizationId: string }): Promise<void> {
    const result = await this.#counter.checkLimitForOrganization(input);
    if (!result.exceeded) return;

    logger.info(
      {
        organizationId: input.organizationId,
        currentMonthMessagesCount: result.count,
        activePlanName: result.planName,
        maxMessagesPerMonth: result.maxMessagesPerMonth,
      },
      "Organization has reached plan limit",
    );

    throw new PlanLimitExceededError(result.message, {
      currentMonthMessagesCount: result.count,
      maxMessagesPerMonth: result.maxMessagesPerMonth,
      activePlanName: result.planName,
    });
  }

  /** The daily warning sweep this module's worker hosts, over the warning it composed. */
  usageWarningEventingPipeline(deps: {
    deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  }): StaticPipelineDefinition<never> {
    return buildUsageWarningPipeline({
      sweep: () => this.#warnings.sweep(),
      deleteDispatchedBefore: deps.deleteDispatchedBefore,
    });
  }

  /** The metering pipeline: the meters, the month's count and the limit decisions. */
  usagePipeline(): UsagePipelineDefinition {
    const build = this.#buildUsagePipeline;
    if (!build) throw new Error("Entitlement was composed without its usage pipeline.");
    return build(() => {
      if (!this.#usageSenders) {
        throw new Error(
          "Entitlement cannot send usage commands before its pipeline is registered.",
        );
      }
      return this.#usageSenders;
    });
  }

  connectUsageCommands(commands: EventingCommands<UsagePipelineDefinition>): void {
    this.#usageSenders = {
      countMonth: (data) => commands.countMonth.send(data),
      recordLimitDecision: (data) => commands.recordLimitDecision.send(data),
    };
  }

  /**
   * An end date inside the last hour means "up to now" — the caller's clock was
   * read when the screen rendered and rows have landed since.
   */
  listOrganizationSpend(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]> {
    const now = nowInstant().epochMilliseconds;
    const endDate = now - input.endDate < RECENT_SPEND_WINDOW_MS ? now : input.endDate;

    return this.#spend.findSpendRollups({ ...input, endDate });
  }

  /**
   * The person a plan is resolved for. A door names them by identifier alone, and the only
   * reader downstream, billing's subscription source, decides the override from the
   * impersonator's id, so no directory lookup is needed (peer cut, round 22).
   */
  #resolveCaller(
    input: Readonly<{ user?: PlanProviderUser; operator?: EntitlementOperator }>,
  ): PlanProviderUser | undefined {
    if (input.user) return input.user;
    if (!input.operator) return undefined;
    const { id, impersonatorId } = input.operator;

    return { id, ...(impersonatorId ? { impersonator: { id: impersonatorId } } : {}) };
  }
}
