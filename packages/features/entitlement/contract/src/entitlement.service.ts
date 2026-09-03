import type { Plan } from "./plan";
import type { ResolvePlanInput } from "./provider";

/** Portable capability implemented by the Entitlements server package. */
export abstract class EntitlementService {
  abstract getActivePlan(input: ResolvePlanInput): Promise<Plan>;
}
