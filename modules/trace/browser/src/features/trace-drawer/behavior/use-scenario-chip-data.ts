import { useDrawer } from "@langwatch/browser-host/drawer";
import { scenarioClient } from "@langwatch/scenario-client";

import { useIsReadOnlyTrace } from "../../../behavior/explorer/context/trace-viewer-context.tsx";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { SCENARIO_RUN_STATUS_CONFIG } from "../../../model/suite/scenario-run-status-config.ts";

/**
 * Plain data describing the scenario run a trace belongs to. Returned by
 * `useScenarioChipData`; rendered to JSX by `buildScenarioChipDef`.
 * Splitting data from JSX keeps the hook in `.ts`-land.
 */
export interface ScenarioChipData {
  scenarioRunId: string;
  name: string | null;
  isLoading: boolean;
  status: (typeof SCENARIO_RUN_STATUS_CONFIG)[keyof typeof SCENARIO_RUN_STATUS_CONFIG] | undefined;
  statusKey: keyof typeof SCENARIO_RUN_STATUS_CONFIG | undefined;
  durationInMs: number | null;
  metCriteria: string[];
  unmetCriteria: string[];
  reasoning: string | null;
  openScenarioDrawer: () => void;
}

/**
 * Returns scenario-chip data, or null when the trace isn't part of a
 * scenario run. Pure data — JSX is built downstream.
 */
export function useScenarioChipData(
  scenarioRunId: string | null | undefined,
): ScenarioChipData | null {
  const { project } = useOrganizationTeamProject();
  const isReadOnly = useIsReadOnlyTrace();
  const { openDrawer } = useDrawer();

  const projectId = project?.id;
  const { data, isLoading } = scenarioClient.scenarios.getRunState.useQuery(
    { scenarioRunId: scenarioRunId ?? "", projectId: projectId ?? "" },
    { enabled: !!projectId && !!scenarioRunId && !isReadOnly },
  );

  if (!scenarioRunId) return null;

  const statusKey = data?.status;
  const status = statusKey ? SCENARIO_RUN_STATUS_CONFIG[statusKey] : undefined;

  return {
    scenarioRunId,
    name: data?.name ?? null,
    isLoading,
    status,
    statusKey,
    durationInMs: data?.durationInMs ?? null,
    metCriteria: data?.results?.metCriteria ?? [],
    unmetCriteria: data?.results?.unmetCriteria ?? [],
    reasoning: data?.results?.reasoning ?? null,
    openScenarioDrawer: () => openDrawer("scenarioRunDetail", { urlParams: { scenarioRunId } }),
  };
}
