import {
  EntitlementApi,
  type AuthorizationContextResolver,
  type BaselinePlanSource,
  type EntitlementApi as EntitlementApiContract,
  type EntitlementSource,
  type Plan,
  type PlanEnricher,
  type ResolvePlanInput,
} from "@langwatch/entitlement-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { EntitlementService } from "../services/entitlement.service.ts";

/** Provider-neutral sources supplied by the process composition root. */
export type EntitlementInfrastructure = Readonly<{
  baseline: Plan | BaselinePlanSource;
  license?: EntitlementSource;
  subscription?: EntitlementSource;
  enrichers?: readonly PlanEnricher[];
  authorization?: AuthorizationContextResolver;
}>;

/** The installed entitlement capability over its private resolution service. */
export class EntitlementApp implements EntitlementApiContract {
  static readonly contract = EntitlementApi;
  static readonly dependencies = {};

  readonly #service: EntitlementService;

  private constructor(service: EntitlementService) {
    this.#service = service;
  }

  static create({
    infrastructure,
  }: FeatureSetup<
    typeof EntitlementApp.dependencies,
    EntitlementInfrastructure,
    undefined
  >): EntitlementApp {
    return new EntitlementApp(EntitlementService.create(infrastructure));
  }

  getActivePlan(input: ResolvePlanInput): Promise<Plan> {
    return this.#service.getActivePlan(input);
  }
}
