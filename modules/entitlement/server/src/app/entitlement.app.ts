import {
  EntitlementApi,
  type AuthorizationContextResolver,
  type BaselinePlanSource,
  type EntitlementApi as EntitlementApiContract,
  type EntitlementOperator,
  type EntitlementSource,
  type GetUsageInput,
  type ListOrganizationSpendInput,
  type Plan,
  type PlanEnricher,
  type PlanProviderUser,
  type ProjectSpendRollup,
  type ResolvePlanInput,
  type SendUsageLimitWarningInput,
  type UsageLimitWarning,
  type UsageStats,
} from "@langwatch/entitlement-contract";
import type { PricingModel } from "@langwatch/entitlement-contract";
import { reads, type MembersRead } from "@langwatch/infrastructure/members";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";
import { z } from "zod";
import { buildEntitlementInfrastructure } from "./entitlement-composition.build.ts";
import type { UsageCounter } from "./entitlement.members.ts";
import type { UsageWarning } from "./entitlement.members.ts";
import type { EntitlementRepositories } from "../repositories/entitlement.repositories.ts";
import { EntitlementService } from "../services/entitlement.service.ts";
import { UsageStatsService } from "../services/usage-stats.service.ts";

/**
 * One plan an organization can buy for itself, as the ladder lists it.
 *
 * Annual and monthly variants of one tier are the same rung: an organization
 * already on Accelerate is not offered Accelerate Annual as its next step, and
 * an organization below Accelerate is offered the tier and not a billing
 * period. Collapsing them is the adapter's job, because which types are
 * variants of which is the catalogue's own fact.
 */
export interface CataloguePlan {
  /** The tier, monthly and annual variants collapsed onto one. */
  tier: string;
  /**
   * Every plan type that sits on this rung, the tier itself included.
   *
   * The mapping is the catalogue's own fact and lives with it: which types are
   * billing periods of one tier, and which are currency cuts of it, is not
   * something a policy can work out from a name without eventually being wrong
   * about one.
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
 * The plans an organization may buy without talking to anybody.
 *
 * Deliberately only the self-serve ones. A tier sold by a person — enterprise
 * in either of its pricings — is absent from this list on purpose, and its
 * absence is what tells the next-step policy that an organization on it is
 * account-managed. There is no flag to forget to set.
 *
 * Infrastructure rather than a constant because the ladder is billing's, and
 * the organization's pricing model decides which rungs are on it. No module
 * implements this: every process that wants a next-step answer supplies its
 * own catalogue (billing's plan limits, or a deployment-specific ladder).
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

/**
 * Config schema: whether this is the hosted deployment, which picks the
 * baseline (cloud free vs. self-hosted open-source) and whether a missing
 * subscription is worth reporting; and this process's own name, which every
 * refused capability names as the reason it cannot answer. Both default to
 * the deleted composition's own absent-config answer.
 */
const entitlementAppConfigSchema = z.object({
  isSaas: z.boolean().default(false),
  processName: z.string().default("langwatch"),
});
export type EntitlementAppConfig = z.infer<typeof entitlementAppConfigSchema>;

type EntitlementSetup = FeatureSetup<
  typeof EntitlementApp.dependencies,
  MembersRead<typeof EntitlementApp.reads>,
  EntitlementAppConfig,
  EntitlementRepositories
>;

/** What `dependencies` resolves to, for the direct-injection testing seam. */
type EntitlementDependencies = EntitlementSetup["dependencies"];

/** What a plan allows, and what has been used and spent against it. */
export class EntitlementApp implements EntitlementApiContract {
  static readonly contract = EntitlementApi;
  static readonly dependencies = { users: UserApi };
  static readonly configSchema = entitlementAppConfigSchema;
  /** The logger its absence report writes to. The literal call is what the members generator reads. */
  static readonly reads = reads("logger");

  #plans: EntitlementService;
  #usage: UsageStatsService;
  #warnings: UsageWarning;
  #spend: EntitlementRepositories["spend"];
  #users: UserApi;

  private constructor(
    repositories: EntitlementRepositories,
    members: EntitlementInfrastructure,
    dependencies: EntitlementSetup["dependencies"],
  ) {
    this.#plans = EntitlementService.create(members);
    this.#usage = UsageStatsService.create({
      membership: repositories.membership,
      counter: members.counter,
      plans: this.#plans,
    });
    this.#warnings = members.warnings;
    this.#spend = repositories.spend;
    this.#users = dependencies.users;
  }

  static create({ repositories, members, dependencies, config }: EntitlementSetup): EntitlementApp {
    const infrastructure = buildEntitlementInfrastructure({ logger: members.logger, config });

    return new EntitlementApp(repositories, infrastructure, dependencies);
  }

  /**
   * Constructs the app directly over a hand-built {@link EntitlementInfrastructure},
   * bypassing {@link buildEntitlementInfrastructure} entirely. For tests only:
   * production always goes through `create`, so every collaborator this
   * module composes for itself is exercised the same way a real boot
   * exercises it.
   */
  static createForTesting(setup: {
    repositories: EntitlementRepositories;
    members: EntitlementInfrastructure;
    dependencies: EntitlementDependencies;
  }): EntitlementApp {
    return new EntitlementApp(setup.repositories, setup.members, setup.dependencies);
  }

  async getActivePlan(input: ResolvePlanInput): Promise<Plan> {
    return this.#plans.getActivePlan({
      organizationId: input.organizationId,
      user: await this.#resolveCaller(input),
    });
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
      this.#users.tryFindById({ id: input.operator.id }),
      input.operator.impersonatorId
        ? this.#users.tryFindById({ id: input.operator.impersonatorId })
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
