/**
 * Resolves human-readable names for archived scenarios and targets.
 *
 * Queries `api.suites.resolveArchivedNames` and memoizes the result
 * into arrays with `{ id, name }` or `{ ...target, name }` shape.
 */

import { useMemo } from "react";
import type { SuiteTarget } from "~/server/suites/types";
import { api } from "~/utils/api";

interface ArchivedScenarioRef {
  id: string;
}

interface ArchivedTargetRef {
  type: SuiteTarget["type"];
  referenceId: string;
}

interface UseArchivedItemsResolutionOptions {
  archivedScenarioIds: ArchivedScenarioRef[];
  archivedTargets: ArchivedTargetRef[];
  projectId: string | undefined;
}

export function useArchivedItemsResolution({
  archivedScenarioIds,
  archivedTargets,
  projectId,
}: UseArchivedItemsResolutionOptions) {
  const hasArchived =
    archivedScenarioIds.length > 0 || archivedTargets.length > 0;

  const { data: archivedNames } = api.suites.resolveArchivedNames.useQuery(
    {
      projectId: projectId ?? "",
      scenarioIds: archivedScenarioIds.map((s) => s.id),
      targets: archivedTargets.map((t) => ({
        type: t.type,
        referenceId: t.referenceId,
      })),
    },
    { enabled: !!projectId && hasArchived },
  );

  const archivedScenariosWithNames = useMemo(
    () =>
      archivedScenarioIds.map((s) => ({
        id: s.id,
        name: archivedNames?.scenarios[s.id] ?? s.id,
      })),
    [archivedScenarioIds, archivedNames],
  );

  const archivedTargetsWithNames = useMemo(
    () =>
      archivedTargets.map((t) => ({
        ...t,
        name: archivedNames?.targets[t.referenceId] ?? t.referenceId,
      })),
    [archivedTargets, archivedNames],
  );

  return { archivedScenariosWithNames, archivedTargetsWithNames };
}
