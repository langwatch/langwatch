import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { Context, MiddlewareHandler } from "hono";

import {
  type EnterpriseFeature,
  EnterprisePlanRequiredError,
  isEnterpriseTier,
} from "./plan-gate.errors";

/** What the gate needs from the process it is mounted in. */
export interface EnterprisePlanGatePorts {
  /**
   * The organization the request's authentication already resolved. Returning
   * nothing means authentication has not run yet, which is a wiring mistake
   * rather than a customer refusal.
   */
  readonly organization: (context: Context) => { id: string } | undefined;
  /** The deployment's plan lookup, resolved per request. */
  readonly plans: (context: Context) => PlanProvider;
}

/**
 * Bind the REST plan gate to one process's organization resolution and plan
 * lookup, and get back the middleware factory every gated route mounts.
 *
 * The gate is a plain middleware, not a feature of any route builder: a family
 * that needs it names it in its own chain, which is what lets the REST service
 * builder stay ignorant of Enterprise entirely.
 *
 * Mount it AFTER organization authentication and AFTER the RBAC check. It
 * reads the organization that authentication resolved, so an app-level `.use`
 * would run too early and find nothing; and "you don't have access" must beat
 * "your plan doesn't include this", which is the tRPC gate's ordering too.
 *
 * Fail-closed: a plan lookup that rejects propagates, so the request is
 * refused and the family's error handler renders it with a trace id. Only a
 * resolved Enterprise plan lets the request through.
 *
 * Throws rather than responding: the family's error handler owns the response
 * shape, and the error carries meta.feature plus the remediation channel so a
 * CLI or agent can render upgrade guidance.
 */
export function createEnterprisePlanGate(
  ports: EnterprisePlanGatePorts,
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
