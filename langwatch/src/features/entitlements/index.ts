// Entitlement constants and types
export { entitlements, type Entitlement } from "./constants";

// Plan mapping
export { getEntitlementsForPlan, type Plan } from "./plans";

// Server-side utilities
export {
  hasEntitlement,
  hasEntitlementForCurrentPlan,
  requireEntitlement,
  requireEntitlementForCurrentPlan,
  checkEntitlement,
} from "./server";

// Client-side hooks
export { useHasEntitlement, useCurrentPlan } from "./hooks";
