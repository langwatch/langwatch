import { createEnterprisePlanGate, type EnterpriseFeature } from "@langwatch/enterprise-plan-gate";
import type { MiddlewareHandler } from "hono";
import type { Organization } from "~/generated/prisma/client";

/**
 * This process's REST Enterprise plan gate.
 *
 * The refusal, the capability vocabulary and the check itself belong to
 * `@langwatch/enterprise-plan-gate`; what cannot live there is where this
 * process keeps the resolved organization and its plan lookup. Those are
 * bound here, once.
 *
 * Mount it per route, after organization authentication and after the RBAC
 * check: it reads the organization that authentication resolved, so an
 * app-level `.use` would run first and find none, and "you don't have access"
 * must beat "your plan doesn't include this".
 */
const enterprisePlanGate = createEnterprisePlanGate({
  organization: (context) => context.get("organization") as Organization | undefined,
  plans: (context) => context.app.planProvider,
});

/** Refuses the route with `enterprise_plan_required` (402) off an unentitled plan. */
export function requireEnterprisePlanRest(feature: EnterpriseFeature): MiddlewareHandler {
  return enterprisePlanGate(feature);
}
