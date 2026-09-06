import { z } from "zod";
import { planGatesSchema } from "./gates.ts";
import { planLimitSchema } from "./limits.ts";
import type { Deployment } from "./plan-type.ts";
import type { Plan } from "./plan.ts";
import { planCatalogue } from "./catalogue.ts";

/**
 * A bespoke contract, never a new entry in the catalogue: only what the
 * contract settled, plus the provenance that makes an organization
 * account-managed rather than an inference from where the plan was read.
 */
export const planOverrideSchema = z.object({
  provenance: z.enum(["licence", "negotiated"]),
  limits: z
    .object({
      members: planLimitSchema,
      membersLite: planLimitSchema,
      volume: planLimitSchema,
      seats: planLimitSchema,
      automationDailyDispatch: planLimitSchema,
      visibility: planLimitSchema,
    })
    .partial(),
  gates: planGatesSchema.partial(),
});
export type PlanOverride = z.infer<typeof planOverrideSchema>;

/**
 * Seats are the deliberate exception: the unlicensed baseline is uncapped, so
 * flooring them would make every seat clause unenforceable.
 */
const FLOORED_LIMITS = ["volume", "automationDailyDispatch"] as const;

/**
 * Applies a contract over a plan. An explicit value always wins, including an
 * explicit false; an absent value falls to the plan's own tier; and on
 * self-hosted everything except seats floors at the open-source baseline.
 */
export function applyOverride({
  deployment,
  override,
  plan,
}: {
  deployment: Deployment;
  override: PlanOverride;
  plan: Plan;
}): Plan {
  const limits = { ...plan.limits, ...override.limits };
  const gates = { ...plan.gates, ...override.gates };

  if (deployment === "self-hosted") {
    const baseline = planCatalogue.baseline("self-hosted");
    for (const name of FLOORED_LIMITS) {
      const floor = baseline.limits[name];
      const current = limits[name];
      if (current.value < floor.value) limits[name] = { ...current, value: floor.value };
    }
    gates.canPublish = gates.canPublish || baseline.gates.canPublish;
  }

  return { ...plan, accountManaged: true, gates, limits };
}
