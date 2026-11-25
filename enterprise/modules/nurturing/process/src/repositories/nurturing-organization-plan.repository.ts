// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";

import type { NurturingPlanFoldState } from "../rules/nurturing-organization-plan.rules.ts";

/**
 * Nurturing's own copy of each organization's plan (`NurturingOrganizationPlan`): the store of
 * the plan's peer fold over billing's subscription_changed facts, one row per organization (the
 * fold's aggregate), with the ids of the events folded in, so a redelivery folds once, and the
 * event of the fact that won, the only one whose delivery tells Customer.io.
 */
export interface NurturingOrganizationPlanRepository extends FoldProjectionStore<NurturingPlanFoldState> {
  /** Required here: the fold dedupes a redelivered fact by the ids it stored. */
  getWithApplied: NonNullable<FoldProjectionStore<NurturingPlanFoldState>["getWithApplied"]>;
}
