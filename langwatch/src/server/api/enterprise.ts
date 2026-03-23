import { TRPCError } from "@trpc/server";
import { getApp } from "~/server/app-layer/app";
import type { PlanProviderUser } from "~/server/app-layer/subscription/plan-provider";

export const ENTERPRISE_FEATURE_ERRORS = {
  RBAC: "Custom roles require an Enterprise plan",
  AUDIT_LOGS: "Audit logs require an Enterprise plan",
  SCIM: "SCIM provisioning requires an Enterprise plan",
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
  const plan = await getApp().planProvider.getActivePlan({
    organizationId,
    user,
  });

  assertEnterprisePlanType({ planType: plan.type, errorMessage });
}
