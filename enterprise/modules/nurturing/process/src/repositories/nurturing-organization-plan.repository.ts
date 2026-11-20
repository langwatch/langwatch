// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingPlanFact,
  NurturingPlanHeld,
} from "../rules/nurturing-organization-plan.rules.ts";

/**
 * Nurturing's own copy of each organization's plan (`NurturingOrganizationPlan`), folded from
 * billing's subscription_changed facts, so a stale or losing fact tells Customer.io nothing.
 */
export interface NurturingOrganizationPlanRepository {
  findPlan(input: Readonly<{ organizationId: string }>): Promise<NurturingPlanHeld>;
  /** Writes the fact only where `planFactChangesCopy` lets it: a racing loser changes nothing. */
  recordPlan(input: Readonly<{ organizationId: string; fact: NurturingPlanFact }>): Promise<void>;
}
