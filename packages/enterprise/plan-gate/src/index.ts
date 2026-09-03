// ---------------------------------------------------------------------------
// @langwatch/enterprise-plan-gate -- the one Enterprise plan refusal
//
// A deployment sells the Enterprise surface; this package is where a request
// for it is allowed or refused, and it is the only place that decision is
// made. Three doors, one rule:
//
//   - REST      createEnterprisePlanGate(ports)(feature) -> Hono middleware,
//               402 enterprise_plan_required
//   - tRPC      requireEnterprisePlan(message) -> procedure middleware,
//               403 FORBIDDEN with the same sentence
//   - imperative assertEnterprisePlan({ planProvider, ... }) for service code
//               that gates inside a handler
//
// It reads a plan through the entitlement contract and nothing else: no
// database, no session, no environment. The process supplies the lookup.
// ---------------------------------------------------------------------------

export {
  ENTERPRISE_FEATURE_ERRORS,
  type EnterpriseFeature,
  EnterprisePlanRequiredError,
  isEnterpriseTier,
} from "./plan-gate.errors";
export { assertEnterprisePlan, assertEnterprisePlanType, requireEnterprisePlan } from "./plan-gate";
export { createEnterprisePlanGate, type EnterprisePlanGatePorts } from "./plan-gate.rest";
