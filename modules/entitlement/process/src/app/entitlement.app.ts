import { BillingApi } from "@langwatch/enterprise-billing-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
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
} from "@langwatch/entitlement-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  resolveRequestBound,
  type RequestBoundKey,
  type RequestBoundsOverrides,
} from "@langwatch/plans";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { EntitlementRepositories } from "../repositories/entitlement.repositories.ts";
import { EntitlementService } from "../services/entitlement.service.ts";
import { PlanNextStepService } from "../services/plan-next-step.service.ts";
import { SelfServePlanCatalogueService } from "../services/self-serve-plan-catalogue.service.ts";
import { UsageStatsService } from "../services/usage-stats.service.ts";
import { buildEntitlementInfrastructure } from "./entitlement-composition.build.ts";
import type { UsageCounter, UsageWarning } from "./entitlement.members.ts";

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

/** How recent an end date has to be for the rollup to read it as "up to now". */
const RECENT_SPEND_WINDOW_MS = 1000 * 60 * 60;

/** `isSaas` (out of scope, see the handoff) and `processName` (a process
 * fact) are unclassified facts this module could not turn into env config. */
type EntitlementMembers = MembersRead<readonly ["logger"]> &
  Readonly<{ isSaas: boolean; processName: string }>;

type EntitlementSetup = FeatureSetup<
  typeof EntitlementApp.dependencies,
  EntitlementMembers,
  EntitlementConfig,
  EntitlementRepositories
>;

/** What `dependencies` resolves to, for the direct-injection testing seam. */
type EntitlementDependencies = EntitlementSetup["dependencies"];

/**
 * What the constructor actually reads off `dependencies`: the caller
 * directory alone. `license` is consumed once, by `create`, to build
 * {@link EntitlementInfrastructure} — a hand-built test app needs no license source.
 */
type EntitlementCallerLookup = Pick<EntitlementDependencies, "users">;

/** What a plan allows, and what has been used and spent against it. */
export class EntitlementApp implements EntitlementApiContract {
  static readonly contract = EntitlementApi;
  static readonly dependencies = { users: UserApi, license: LicensingApi, billing: BillingApi };
  static readonly config = entitlementConfig;
  /** `logger` is the closed member; `isSaas`/`processName` are named raw so
   * `withMember`/`withMembers` can answer them (see {@link EntitlementMembers}). */
  static readonly reads = [...reads("logger"), "isSaas", "processName"] as const;

  #plans: EntitlementService;
  #usage: UsageStatsService;
  #nextStep: PlanNextStepService;
  #warnings: UsageWarning;
  #spend: EntitlementRepositories["spend"];
  #users: UserApi;
  #requestBoundOverrides: RequestBoundsOverrides;

  private constructor({
    repositories,
    members,
    dependencies,
    config,
  }: {
    repositories: EntitlementRepositories;
    members: EntitlementInfrastructure;
    dependencies: EntitlementCallerLookup;
    config: EntitlementConfig;
  }) {
    this.#plans = EntitlementService.create(members);
    this.#usage = UsageStatsService.create({
      membership: repositories.membership,
      counter: members.counter,
      plans: this.#plans,
    });
    this.#nextStep = PlanNextStepService.create({
      catalogue: SelfServePlanCatalogueService.create(),
    });
    this.#warnings = members.warnings;
    this.#spend = repositories.spend;
    this.#users = dependencies.users;
    this.#requestBoundOverrides = config.requestBounds ?? {};
  }

  static create({ repositories, members, dependencies, config }: EntitlementSetup): EntitlementApp {
    const infrastructure = buildEntitlementInfrastructure({
      logger: members.logger,
      isSaas: members.isSaas,
      processName: members.processName,
      license: dependencies.license,
      billing: dependencies.billing,
    });

    return new EntitlementApp({ repositories, members: infrastructure, dependencies, config });
  }

  /**
   * Constructs the app directly over a hand-built {@link EntitlementInfrastructure},
   * bypassing {@link buildEntitlementInfrastructure}. For tests only —
   * production always goes through `create`, exercising every collaborator the same way.
   */
  static createForTesting(setup: {
    repositories: EntitlementRepositories;
    members: EntitlementInfrastructure;
    dependencies: EntitlementCallerLookup;
    config?: EntitlementConfig;
  }): EntitlementApp {
    return new EntitlementApp({
      repositories: setup.repositories,
      members: setup.members,
      dependencies: setup.dependencies,
      config: { requestBounds: setup.config?.requestBounds },
    });
  }

  async getActivePlan(input: ResolvePlanInput): Promise<Plan> {
    return this.#plans.getActivePlan({
      organizationId: input.organizationId,
      user: await this.#resolveCaller(input),
    });
  }

  /**
   * A plain-number override answers on every tier without a plan lookup;
   * otherwise the active plan resolves through the same path `getActivePlan`
   * uses, and its tier's bound answers — per-tier overrides included.
   */
  async requestBound(input: { key: RequestBoundKey; organizationId: string }): Promise<number> {
    const override = this.#requestBoundOverrides[input.key];
    if (typeof override === "number") return override;

    const plan = await this.#plans.getActivePlan({ organizationId: input.organizationId });

    return resolveRequestBound(input.key, plan.type, this.#requestBoundOverrides);
  }

  resolvePlanNextStep(
    input: Readonly<{ plan: Plan; pricingModel: PricingModel | null; currency?: "USD" | "EUR" }>,
  ): Promise<PlanNextStep> {
    return this.#nextStep.resolve(input);
  }

  async getUsage(input: GetUsageInput): Promise<UsageStats> {
    const user = await this.#resolveCaller(input);

    return this.#usage.getUsageStats(input.organizationId, user);
  }

  sendUsageLimitWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning> {
    return this.#warnings.sendWarning(input);
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
   * The person a plan is resolved for. A door names them by identifier alone,
   * and the subscription source reads an email off the operator impersonating
   * them, so the directory lookup happens here rather than in a transport.
   */
  async #resolveCaller(
    input: Readonly<{ user?: PlanProviderUser; operator?: EntitlementOperator }>,
  ): Promise<PlanProviderUser | undefined> {
    if (input.user) return input.user;
    if (!input.operator) return undefined;

    const [caller, impersonator] = await Promise.all([
      this.#users.findById({ id: input.operator.id }),
      input.operator.impersonatorId
        ? this.#users.findById({ id: input.operator.impersonatorId })
        : Promise.resolve(null),
    ]);

    return {
      id: input.operator.id,
      email: caller?.email ?? null,
      name: caller?.name ?? null,
      ...(impersonator ? { impersonator: { email: impersonator.email } } : {}),
    };
  }
}
