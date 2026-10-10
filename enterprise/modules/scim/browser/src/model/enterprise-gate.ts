// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The directory reads refuse in one expected way: the plan does not carry SCIM
 * (`enterprise_plan_required`). That is a plan state, so the summary says it as
 * an upsell rather than as a failure. Read off the serialised envelope, as
 * browser-host's `isNotFoundError` does, so no transport class is named here.
 */
export function isEnterpriseGateError(error: unknown): boolean {
  const code = (error as { data?: { error?: { code?: unknown } } } | null)?.data?.error?.code;
  return code === "enterprise_plan_required";
}
