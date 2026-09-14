// Single place Enterprise plan decisions are made (REST, tRPC, imperative).
// Reads plan through entitlement contract only; process supplies lookup.

export {
  ENTERPRISE_FEATURE_ERRORS,
  type EnterpriseFeature,
  EnterprisePlanRequiredError,
  isEnterpriseTier,
} from "./plan-gate.errors.ts";
export { assertEnterprisePlan, assertEnterprisePlanType, requireEnterprisePlan } from "./plan-gate.ts";
export { createEnterprisePlanGate, type EnterprisePlanGateMembers } from "./plan-gate.rest.ts";
