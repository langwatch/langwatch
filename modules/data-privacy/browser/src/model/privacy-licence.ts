/**
 * The license the Data Privacy page reads for the self-hosted PII redaction model.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import { isEnterpriseTier } from "@langwatch/entitlement-contract";

import type { PrivacyLicence } from "./data-privacy-host.ts";

/** Self-hosted only, and only for a reader who may view the organization's plan. */
export function mayReadPlan({
  isSaaS,
  organizationId,
  canViewOrganization,
}: {
  isSaaS: boolean;
  organizationId: string | undefined;
  canViewOrganization: boolean;
}): boolean {
  return !isSaaS && !!organizationId && canViewOrganization;
}

/** The plan read as a license: a refused or failed read is unknown, never "not licensed". */
export function licenceOf({
  mayRead,
  plan,
}: {
  mayRead: boolean;
  plan: { isLoading: boolean; isError: boolean; data: { type: string } | undefined };
}): PrivacyLicence {
  if (!mayRead) return "unknown";
  if (plan.isLoading) return "loading";
  // A failed refresh keeps the last answer in data: the failure wins over it.
  if (plan.isError || !plan.data) return "unknown";
  return isEnterpriseTier(plan.data.type) ? "enterprise" : "none";
}
