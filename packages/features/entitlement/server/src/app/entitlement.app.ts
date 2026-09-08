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
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";
import { UsageCounterPort } from "../ports/usage-counter.port.ts";
import { UsageWarningPort } from "../ports/usage-warning.port.ts";
import type { EntitlementRepositories } from "../repositories/entitlement.repositories.ts";
import { EntitlementService } from "../services/entitlement.service.ts";
import { UsageStatsService } from "../services/usage-stats.service.ts";

/** Provider-neutral sources and readings supplied by the process composition root. */
export type EntitlementInfrastructure = Readonly<{
  baseline: Plan | BaselinePlanSource;
  license?: EntitlementSource;
  subscription?: EntitlementSource;
  enrichers?: readonly PlanEnricher[];
  authorization?: AuthorizationContextResolver;
  /** The month's billable volume, counted in the deployment's analytics store. */
  counter: UsageCounterPort;
  /** The approaching-limit mail, over the deployment's gateway. */
  warnings: UsageWarningPort;
}>;

/** How recent an end date has to be for the rollup to read it as "up to now". */
const RECENT_SPEND_WINDOW_MS = 1000 * 60 * 60;

type EntitlementSetup = FeatureSetup<
  typeof EntitlementApp.dependencies,
  EntitlementInfrastructure,
  undefined,
  EntitlementRepositories
>;

/** What a plan allows, and what has been used and spent against it. */
export class EntitlementApp implements EntitlementApiContract {
  static readonly contract = EntitlementApi;
  static readonly dependencies = { users: UserApi };

  #plans: EntitlementService;
  #usage: UsageStatsService;
  #warnings: UsageWarningPort;
  #spend: EntitlementRepositories["spend"];
  #users: UserApi;

  private constructor(
    repositories: EntitlementRepositories,
    infrastructure: EntitlementInfrastructure,
    dependencies: EntitlementSetup["dependencies"],
  ) {
    this.#plans = EntitlementService.create(infrastructure);
    this.#usage = UsageStatsService.create({
      membership: repositories.membership,
      counter: infrastructure.counter,
      plans: this.#plans,
    });
    this.#warnings = infrastructure.warnings;
    this.#spend = repositories.spend;
    this.#users = dependencies.users;
  }

  static create({ repositories, infrastructure, dependencies }: EntitlementSetup): EntitlementApp {
    return new EntitlementApp(repositories, infrastructure, dependencies);
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
