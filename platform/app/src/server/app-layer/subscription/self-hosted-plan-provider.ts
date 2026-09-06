import { floorAtOssBaseline } from "../../../../ee/licensing/ossBaselineFloor";
import type { PlanProvider } from "./plan-provider";

/**
 * PlanProvider for self-hosted deployments, where the stored license is the
 * only source of a plan.
 *
 * The license-resolved plan is floored at the open-source baseline, so
 * activating a license only ever adds capability. See `floorAtOssBaseline`.
 *
 * A deployment without a license resolves to the baseline itself, which is
 * flagged `free`; that is what distinguishes the two plan sources here.
 *
 * Whether a license still counts is settled before this point, by the resolver
 * wired in `presets.ts`: a license past its end date arrives here as the plan it
 * sold, not as the baseline, and is floored and reported like any other.
 */
export function createSelfHostedPlanProvider({
  licensePlanProvider,
}: {
  licensePlanProvider: PlanProvider;
}): PlanProvider {
  return {
    async getActivePlan({ organizationId }) {
      const plan = await licensePlanProvider.getActivePlan({ organizationId });

      if (plan.free) {
        return { ...plan, planSource: "free" as const };
      }

      return { ...floorAtOssBaseline(plan), planSource: "license" as const };
    },
  };
}
