// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PlanTypes } from "@langwatch/enterprise-billing-contract";

const KNOWN_PLANS: ReadonlySet<string> = new Set(Object.values(PlanTypes));

/**
 * The plan peers are told an organization is on: its active subscription's, FREE with none or an
 * unknown one, as plan-provider.service.ts falls back. A pending checkout is not active.
 */
export function activePlanOf({ active }: { active: { plan: string } | null }): string {
  if (active && KNOWN_PLANS.has(active.plan)) return active.plan;
  return PlanTypes.FREE;
}
