import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { Context, MiddlewareHandler } from "hono";

import {
  type EnterpriseFeature,
  EnterprisePlanRequiredError,
  isEnterpriseTier,
} from "./plan-gate.errors.ts";

/** What the gate needs from the process it is mounted in. */
export interface EnterprisePlanGateMembers {
  /**
   * The organization the request's authentication already resolved. Returning
   * nothing means authentication has not run yet, which is a wiring mistake
   * rather than a customer refusal.
   */
  readonly organization: (context: Context) => { id: string } | undefined;
  /** The deployment's plan lookup, resolved per request. */
  readonly plans: (context: Context) => PlanProvider;
}

/** Plan gate middleware; mount after org auth and RBAC (before both). Throws so
 * error handler renders with trace id and upgrade guidance.
 */
export function createEnterprisePlanGate(
  ports: EnterprisePlanGateMembers,
): (feature: EnterpriseFeature) => MiddlewareHandler {
  return (feature) => async (context, next) => {
    const organization = ports.organization(context);
    if (!organization) {
      // A route wired with this gate but without org auth is a programming
      // error, not a customer refusal, so degrade to the generic unknown path.
      throw new Error(
        "The Enterprise plan gate ran without an organization on context; mount it after the organization authentication middleware",
      );
    }

    const plan = await ports.plans(context).getActivePlan({
      organizationId: organization.id,
    });

    if (!isEnterpriseTier(plan.type)) {
      throw new EnterprisePlanRequiredError(feature);
    }

    await next();
  };
}
