// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";

import type {
  NurturingPlanFact,
  NurturingPlanFoldState,
  NurturingPlanHeld,
} from "../rules/nurturing-organization-plan.rules.ts";

/**
 * Nurturing's own copy of each organization's plan (`NurturingOrganizationPlan`), folded from
 * billing's subscription_changed facts, so a stale or losing fact tells Customer.io nothing. This
 * is the plan sync's side of it, without the fold's store: a service never writes the projection.
 */
export interface NurturingOrganizationPlanCopyRepository {
  findPlan(input: Readonly<{ organizationId: string }>): Promise<NurturingPlanHeld>;
  /** Writes the fact only where `planFactChangesCopy` lets it: a racing loser changes nothing. */
  recordPlan(input: Readonly<{ organizationId: string; fact: NurturingPlanFact }>): Promise<void>;
}

/**
 * The plan copy, and the store of the plan's peer fold: one row per organization (the fold's
 * aggregate), with the ids of the events folded in, so a redelivery folds once.
 */
export interface NurturingOrganizationPlanRepository
  extends NurturingOrganizationPlanCopyRepository, FoldProjectionStore<NurturingPlanFoldState> {
  /** Required here: the fold dedupes a redelivered fact by the ids it stored. */
  getWithApplied: NonNullable<FoldProjectionStore<NurturingPlanFoldState>["getWithApplied"]>;
}
