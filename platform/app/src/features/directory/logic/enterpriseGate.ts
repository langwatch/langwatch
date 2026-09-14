/**
 * The directory reads 403 in exactly one expected way: the organization's
 * plan does not carry SCIM provisioning (`ENTERPRISE_FEATURE_ERRORS.SCIM`,
 * thrown as a bare tRPC `FORBIDDEN` by `requireEnterprisePlan`).
 *
 * That is a plan state, not a failure — the reader broke nothing and there
 * is nothing to trace — so the surfaces that read the directory name it
 * themselves, as an upsell, rather than handing it to the error registry's
 * failure dialect. Any other error still goes to `SectionErrorNotice`.
 */
export function isEnterpriseGateError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { data, message } = error as {
    data?: { code?: string };
    message?: string;
  };
  return data?.code === "FORBIDDEN" && /enterprise plan/i.test(message ?? "");
}
