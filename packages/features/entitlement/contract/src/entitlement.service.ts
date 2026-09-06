import type { Plan } from "./plan.ts";
import type { ResolvePlanInput } from "./provider.ts";

/** Portable capability implemented by the Entitlements server package. */
export abstract class EntitlementService {
  abstract getActivePlan(input: ResolvePlanInput): Promise<Plan>;
}
