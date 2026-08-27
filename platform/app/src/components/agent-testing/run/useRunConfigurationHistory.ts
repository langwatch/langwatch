/**
 * The configurations a scope already ran with, for the run name dropdown.
 *
 * The source is the stored run plans: each one holds the targets, the repeat
 * count and the models its last run used, which is exactly one configuration
 * of its own scope. When the server read that records a configuration per run
 * lands, only `entriesFromPlans` is replaced; every caller reads the same
 * entry shape.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useMemo } from "react";
import type { SimulationSuite } from "~/generated/prisma/client";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import { parseSuiteScope } from "~/server/suites/scope";
import { suiteTargetSchema } from "~/server/suites/types";
import { api } from "~/utils/api";
import {
  configurationKeyOf,
  configurationsForScope,
  type RunConfigurationEntry,
  type RunScope,
  sortTargets,
} from "./run-configuration";

/** The targets a stored plan holds, dropping anything that no longer parses. */
function targetsOf(plan: SimulationSuite) {
  const raw = Array.isArray(plan.targets) ? plan.targets : [];
  return raw.flatMap((entry) => {
    const parsed = suiteTargetSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * What a stored plan covers.
 *
 * A folder is only a grouping, so its scope is itself. Every other plan
 * carries its rule, and a hand-picked one carries its list inside it.
 */
function scopeOf(plan: SimulationSuite): RunScope {
  if (plan.kind === "folder") return { mode: "folders", folderIds: [plan.id] };
  const stored = parseSuiteScope(plan.scope);
  if (stored.mode === "cases") {
    return { mode: "cases", caseIds: [...plan.scenarioIds] };
  }
  return stored;
}

/** One entry per stored plan, in the shape the dropdown reads. */
export function entriesFromPlans(
  plans: readonly SimulationSuite[],
): RunConfigurationEntry[] {
  return plans.map((plan) => {
    const targets = sortTargets(targetsOf(plan));
    // The overrides ride on the target the run was configured with; a plan
    // with no target has none.
    const runParameters: RunParameterValues = targets[0]?.runParameters ?? {};
    const configuration = {
      scope: scopeOf(plan),
      targets,
      repeatCount: plan.repeatCount,
      simulatorModel: plan.simulatorModel,
      judgeModel: plan.judgeModel,
    };

    return {
      key: configurationKeyOf({ configuration, runParameters }),
      planId: plan.id,
      planName: plan.name,
      configuration,
      runParameters,
      lastRunAt: plan.updatedAt,
    };
  });
}

/**
 * The configurations of this scope, newest first.
 *
 * An empty list is the ordinary state of a scope that never ran, and the name
 * field reads as a plain input when it comes back empty.
 */
export function useRunConfigurationHistory({
  scope,
  isEnabled,
}: {
  scope: RunScope | null;
  isEnabled: boolean;
}): RunConfigurationEntry[] {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const { data: plans } = api.suites.getAll.useQuery(
    { projectId, kinds: ["custom", "folder"] },
    { enabled: isEnabled && !!projectId },
  );

  return useMemo(() => {
    if (!scope || !plans) return [];
    return configurationsForScope({
      entries: entriesFromPlans(plans),
      scope,
    });
  }, [plans, scope]);
}
