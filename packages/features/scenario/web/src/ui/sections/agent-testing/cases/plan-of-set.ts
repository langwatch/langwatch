/**
 * Which run plan a scenario set belongs to.
 *
 * A run belongs to the set it was written into, and the Results tab lists
 * plans, not sets. A set derived from a test suite belongs to the plan of that
 * suite; a set a code run wrote belongs to a plan named after the set itself.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { isInternalSetId } from "@langwatch/scenario-contract";
import { tryExtractSuiteId } from "@langwatch/suite-contract";
import { toExternalPlanSlug } from "../../../../behavior/agent-testing/results/run-plans";

/** The plan of one run set: the name a row reads and the address it opens. */
export type PlanIdentity = { planName: string; planSlug: string };

export function planOfSet({
  scenarioSetId,
  planBySuiteId,
}: {
  scenarioSetId: string | undefined;
  /** Every test suite of the project, keyed by id. */
  planBySuiteId: ReadonlyMap<string, PlanIdentity>;
}): PlanIdentity | null {
  if (!scenarioSetId) return null;
  const suiteId = tryExtractSuiteId(scenarioSetId);
  if (suiteId) return planBySuiteId.get(suiteId) ?? null;
  // The reserved sets of the platform are not run plans and the Results tab
  // lists none of them, so a run of one has nothing to open.
  if (isInternalSetId(scenarioSetId)) return null;
  // Any other set was written by a code run, and the Results tab lists it
  // under the name the code gave it.
  return {
    planName: scenarioSetId,
    planSlug: toExternalPlanSlug(scenarioSetId),
  };
}
