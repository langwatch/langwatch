import { HandledError, remediation } from "@langwatch/handled-error";

/** Single source of truth for Enterprise capabilities across all gates (REST,
 * tRPC, imperative) to prevent inconsistent sales.
 */
export const ENTERPRISE_FEATURE_ERRORS = {
  RBAC: "Custom roles require an Enterprise plan",
  AUDIT_LOGS: "Audit logs require an Enterprise plan",
  SCIM: "SCIM provisioning requires an Enterprise plan",
  SSO: "Single sign-on requires an Enterprise plan",
  ANOMALY_RULES: "Anomaly rules require an Enterprise plan",
  ACTIVITY_MONITOR: "The activity monitor requires an Enterprise plan",
  INGESTION_SOURCES: "Ingestion sources require an Enterprise plan",
  OCSF_EXPORT: "OCSF compliance export requires an Enterprise plan",
  MANAGEMENT_API: "The management API requires an Enterprise plan",
  GROUPS: "Groups require an Enterprise plan",
} as const;

export type EnterpriseFeature = keyof typeof ENTERPRISE_FEATURE_ERRORS;

function isEnterpriseFeature(value: string): value is EnterpriseFeature {
  return Object.hasOwn(ENTERPRISE_FEATURE_ERRORS, value);
}

export class EnterprisePlanRequiredError extends HandledError {
  declare readonly code: "enterprise_plan_required";

  constructor(featureOrMessage: string) {
    const feature = isEnterpriseFeature(featureOrMessage) ? featureOrMessage : undefined;
    const message = feature ? ENTERPRISE_FEATURE_ERRORS[feature] : featureOrMessage;

    super("enterprise_plan_required", message, {
      httpStatus: 403,
      ...(feature ? { meta: { feature } } : {}),
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
