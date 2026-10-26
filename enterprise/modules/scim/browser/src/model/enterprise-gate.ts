// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { EnterprisePlanRequiredError } from "@langwatch/entitlement-contract";

/**
 * The directory reads refuse in one expected way: the plan does not carry SCIM
 * (`enterprise_plan_required`). That is a plan state, so the summary says it as
 * an upsell rather than as a failure. The entitlement contract's class reads the
 * serialised envelope, so no transport class is named here.
 */
export function isEnterpriseGateError(error: unknown): boolean {
  return EnterprisePlanRequiredError.is(error);
}
