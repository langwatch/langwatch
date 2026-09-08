import { featureApi } from "@langwatch/runtime-composition";
import type { Plan } from "./plan.ts";
import type { ResolvePlanInput } from "./provider.ts";

/** The provider-neutral entitlement capability exposed to feature peers. */
export interface EntitlementApi {
  getActivePlan(input: ResolvePlanInput): Promise<Plan>;
}

export const EntitlementApi = featureApi<EntitlementApi>("entitlement");
