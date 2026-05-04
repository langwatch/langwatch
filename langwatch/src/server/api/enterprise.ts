import { TRPCError } from "@trpc/server";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import type { PlanProviderUser } from "~/server/app-layer/subscription/plan-provider";

/**
 * Dev-only bypass for Enterprise gating, intended for dogfood / capture
 * runs against a self-hosted dev stack without a signed license. Honors
 * the same intent as planProvider.ts:70-75 (self-hosted → ENTERPRISE
 * features) without changing the production licensing semantics.
 *
 * Set `LANGWATCH_DEV_FORCE_ENTERPRISE=true` in .env to opt in. Has no
 * effect when IS_SAAS=true (production SaaS deploys ignore the bypass).
 */
function isDevForceEnterpriseEnabled(): boolean {
  return !env.IS_SAAS && env.LANGWATCH_DEV_FORCE_ENTERPRISE === true;
}

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
  INGESTION_SOURCES: "Ingestion sources require an Enterprise plan",
  OCSF_EXPORT: "OCSF compliance export requires an Enterprise plan",
} as const;

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
  if (isDevForceEnterpriseEnabled()) return;
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
