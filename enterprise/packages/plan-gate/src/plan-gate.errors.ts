import { HandledError, remediation } from "@langwatch/handled-error";

/**
 * The Enterprise capabilities a deployment can be refused, and the sentence
 * each refusal carries.
 *
 * One list, because the REST gate, the tRPC gate and the imperative assertion
 * all have to agree on what "Enterprise" covers: a capability named in one and
 * missing from another is a surface that sells differently depending on which
 * door a caller knocks on.
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
 * REST-only by design: the tRPC surface keeps `requireEnterprisePlan`, which
 * answers FORBIDDEN with the same sentences.
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

/**
 * The one place a plan type is read as "Enterprise".
 *
 * Deliberately an equality test rather than a tier ordering: every other plan
 * type a lookup can produce — the cloud free tier (`FREE`), the unlicensed
 * self-hosted baseline (`OPEN_SOURCE`), any paid tier below Enterprise — is
 * not Enterprise, so a plan this function has never heard of refuses rather
 * than passes.
 */
export function isEnterpriseTier(planType: string): boolean {
  return planType === "ENTERPRISE";
}
