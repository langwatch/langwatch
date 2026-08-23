import {
  EntitlementsService as EntitlementsServiceContract,
  planSchema,
  type AuthorizationContextResolver,
  type BaselinePlanSource,
  type EntitlementSource,
  type Plan,
  type PlanEnricher,
  type PlanProvider,
  type PlanProviderUser,
  type PlanSource,
  type ResolvePlanInput,
} from "@langwatch/entitlements-contract";

export type EntitlementsServiceOptions = {
  baseline: Plan | BaselinePlanSource;
  license?: EntitlementSource;
  subscription?: EntitlementSource;
  enrichers?: readonly PlanEnricher[];
  authorization?: AuthorizationContextResolver;
};

export class EntitlementsService
  extends EntitlementsServiceContract
  implements PlanProvider
{
  static create(options: EntitlementsServiceOptions): EntitlementsService {
    return new EntitlementsService(options);
  }

  private constructor(private readonly options: EntitlementsServiceOptions) {
    super();
  }

  async getActivePlan(input: ResolvePlanInput): Promise<Plan> {
    let plan = await this.resolvePlan(input);
    plan = await this.applyEnrichers(plan, input);
    plan = this.applyAuthorization(plan, input.user);
    return planSchema.parse(plan);
  }

  private async resolvePlan(input: ResolvePlanInput): Promise<Plan> {
    const license = await this.resolvePaidPlan(this.options.license, input);
    if (license) return this.withSource(license, "license");

    const subscription = await this.resolvePaidPlan(
      this.options.subscription,
      input,
    );
    if (subscription) return this.withSource(subscription, "subscription");

    const baseline = await this.resolveBaseline(input);
    return this.withSource(baseline, "free");
  }

  private async resolvePaidPlan(
    source: EntitlementSource | undefined,
    input: ResolvePlanInput,
  ): Promise<Plan | null> {
    if (!source) return null;
    const plan = await source.resolve(input);
    if (!plan || plan.free) return null;
    return plan;
  }

  private async resolveBaseline(input: ResolvePlanInput): Promise<Plan> {
    if ("resolve" in this.options.baseline) {
      return this.options.baseline.resolve(input);
    }
    return this.options.baseline;
  }

  private withSource(plan: Plan, planSource: PlanSource): Plan {
    const resolved = { ...plan };
    resolved.planSource = planSource;
    return resolved;
  }

  private async applyEnrichers(
    initialPlan: Plan,
    input: ResolvePlanInput,
  ): Promise<Plan> {
    let plan = initialPlan;
    for (const enricher of this.options.enrichers ?? []) {
      plan = await enricher.enrich(plan, input);
    }
    return plan;
  }

  private applyAuthorization(
    plan: Plan,
    user: PlanProviderUser | undefined,
  ): Plan {
    if (!this.options.authorization) return plan;
    const authorized = { ...plan };
    Object.assign(authorized, this.options.authorization.resolve(user));
    return authorized;
  }
}
