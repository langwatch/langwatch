import type { EntitlementSource, Plan } from "@langwatch/entitlement-contract";

export function fixedEntitlementSource(plan: Plan | null): EntitlementSource {
  return { resolve: async () => plan };
}
