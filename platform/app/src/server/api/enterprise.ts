import { HandledError } from "@langwatch/handled-error";
import { TRPCError } from "@trpc/server";
import { getApp } from "~/server/app-layer/app";
import { remediation } from "~/server/app-layer/error-remediation";
import type { PlanProviderUser } from "~/server/app-layer/subscription/plan-provider";

type EnterpriseGateMiddlewareParams = {
  ctx: { session?: { user?: PlanProviderUser } | null };
  input: { organizationId: string };
  next: () => any;
};

export const ENTERPRISE_FEATURE_ERRORS = {
  RBAC: "Custom roles require an Enterprise plan",
  AUDIT_LOGS: "Audit logs require an Enterprise plan",
  SCIM: "SCIM provisioning requires an Enterprise plan",
  ANOMALY_RULES: "Anomaly rules require an Enterprise plan",
  ACTIVITY_MONITOR: "The activity monitor requires an Enterprise plan",
  GOVERNANCE_COST: "Governance cost views require an Enterprise plan",
  INGESTION_SOURCES: "Ingestion sources require an Enterprise plan",
  OCSF_EXPORT: "OCSF compliance export requires an Enterprise plan",
  MANAGEMENT_API: "The management API requires an Enterprise plan",
  GROUPS: "Groups require an Enterprise plan",
} as const;

export type EnterpriseFeature = keyof typeof ENTERPRISE_FEATURE_ERRORS;

/**
 * The plan, not the request, is what refuses here, so the status is 402 and
 * the code is stable, letting a caller distinguish "buy the plan" from "fix
 * the request" (403/422) without reading prose.
 *
 * `meta.feature` names which capability was asked for, and the remediation
 * channel (tips + docs link) rides on the error so CLI and API consumers get
 * upgrade guidance without a UI. `fault` stays `customer`: the refusal is an
 * account state the customer resolves, not a platform failure.
 *
 * REST-only by design: the tRPC surface keeps `requireEnterprisePlan` below,
 * which answers FORBIDDEN with the same sentences.
 */
export class EnterprisePlanRequiredError extends HandledError {
  declare readonly code: "enterprise_plan_required";

  constructor(feature: EnterpriseFeature) {
    super("enterprise_plan_required", ENTERPRISE_FEATURE_ERRORS[feature], {
      httpStatus: 402,
      meta: { feature },
      fault: "customer",
      ...remediation("enterprise_plan_required"),
    });
    this.name = "EnterprisePlanRequiredError";
  }
}

export function isEnterpriseTier(planType: string): boolean {
  return planType === "ENTERPRISE";
}

export function isCustomRole(role: string): boolean {
  return role.startsWith("custom:");
}

export function assertEnterprisePlanType({
  planType,
  errorMessage,
}: {
  planType: string;
  errorMessage: string;
}): void {
  if (!isEnterpriseTier(planType)) {
    throw new TRPCError({ code: "FORBIDDEN", message: errorMessage });
  }
}

export async function assertEnterprisePlan({
  organizationId,
  user,
  errorMessage,
}: {
  organizationId: string;
  user?: PlanProviderUser;
  errorMessage: string;
}): Promise<void> {
  const plan = await getApp().planProvider.getActivePlan({
    organizationId,
    user,
  });

  assertEnterprisePlanType({ planType: plan.type, errorMessage });
}

/**
 * tRPC middleware that 403s any procedure whose org isn't on an
 * Enterprise plan. Compose AFTER `checkOrganizationPermission` so the
 * RBAC denial fires first (UNAUTHORIZED before FORBIDDEN — clearer
 * error attribution: "you don't have access to the org" trumps "your
 * org doesn't have the feature").
 *
 * Usage:
 *   procedure
 *     .use(checkOrganizationPermission("anomalyRules:view"))
 *     .use(requireEnterprisePlan(ENTERPRISE_FEATURE_ERRORS.ANOMALY_RULES))
 *     .query(...)
 */
export const requireEnterprisePlan =
  (errorMessage: string) =>
  async ({ ctx, input, next }: EnterpriseGateMiddlewareParams) => {
    await assertEnterprisePlan({
      organizationId: input.organizationId,
      user: ctx.session?.user,
      errorMessage,
    });
    return next();
  };
