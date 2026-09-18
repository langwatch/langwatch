import { HandledError, remediation } from "@langwatch/handled-error";

/** Single source of truth for Enterprise capabilities across all gates (REST,
 * tRPC, imperative) to prevent inconsistent sales.
 */
export const ENTERPRISE_FEATURE_ERRORS = {
  RBAC: "Custom roles require an Enterprise plan",
  AUDIT_LOGS: "Audit logs require an Enterprise plan",
  SCIM: "SCIM provisioning requires an Enterprise plan",
  ANOMALY_RULES: "Anomaly rules require an Enterprise plan",
  ACTIVITY_MONITOR: "The activity monitor requires an Enterprise plan",
  INGESTION_SOURCES: "Ingestion sources require an Enterprise plan",
  OCSF_EXPORT: "OCSF compliance export requires an Enterprise plan",
  MANAGEMENT_API: "The management API requires an Enterprise plan",
  GROUPS: "Groups require an Enterprise plan",
} as const;

export type EnterpriseFeature = keyof typeof ENTERPRISE_FEATURE_ERRORS;

/** Refuses plan status (402) not request validity (403/422); tRPC uses
 * requireEnterprisePlan which answers FORBIDDEN with same copy.
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

/** Single source for Enterprise plan checks; uses equality not ordering so
 * unknown plans refuse rather than pass.
 */
export function isEnterpriseTier(planType: string): boolean {
  return planType === "ENTERPRISE";
}
