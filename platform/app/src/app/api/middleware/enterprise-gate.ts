import type { Organization } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import {
  type EnterpriseFeature,
  EnterprisePlanRequiredError,
  isEnterpriseTier,
} from "~/server/api/enterprise";
import { getApp } from "~/server/app-layer/app";

/**
 * Refuses the route with `enterprise_plan_required` (402) unless the caller's
 * organization is on an Enterprise plan.
 *
 * Reads the organization the org auth middleware already resolved onto the
 * context, so it MUST run after that middleware. On a SecuredApp that means
 * per-route, after `.access(...)`: an app-level `.use` would run before org
 * auth and find no organization (see the tRPC twin `requireEnterprisePlan`,
 * which composes after `checkOrganizationPermission` for the same reason:
 * "you don't have access" trumps "your plan doesn't include this").
 *
 * Throws rather than responding: the family's error handler owns the response
 * shape, and the error carries meta.feature plus the remediation channel so a
 * CLI or agent can render upgrade guidance.
 */
export function requireEnterprisePlanRest(
  feature: EnterpriseFeature,
): MiddlewareHandler {
  return async (c, next) => {
    const organization = c.get("organization") as Organization | undefined;
    if (!organization) {
      // A route wired with this gate but without org auth is a programming
      // error, not a customer refusal, so degrade to the generic unknown path.
      throw new Error(
        "requireEnterprisePlanRest ran without an organization on context; mount it after the org auth middleware",
      );
    }

    const plan = await getApp().planProvider.getActivePlan({
      organizationId: organization.id,
    });

    if (!isEnterpriseTier(plan.type)) {
      throw new EnterprisePlanRequiredError(feature);
    }

    await next();
  };
}
