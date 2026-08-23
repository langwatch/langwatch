import type { EntitlementSource, Plan } from "@langwatch/entitlements-contract";

export function fixedEntitlementSource(plan: Plan | null): EntitlementSource {
  return { resolve: async () => plan };
}
