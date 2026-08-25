/**
 * What the Agent Testing run drawer reads: the run behind the address, the
 * layout the window allows, and the version of the case the run used.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/features/agent-testing/live-one-off-run.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useScenarioRunDetail } from "~/components/simulations/ScenarioRunDetailDrawer";
import {
  isCancellableStatus,
  useCancelScenarioRun,
} from "~/components/suites/useCancelScenarioRun";
import { useCan } from "~/hooks/useCan";
import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  isTerminalStatus,
  type ScenarioRunStatus,
} from "~/server/scenarios/scenario-event.enums";
import { api } from "~/utils/api";

/** Everything one open drawer knows about the run it is showing. */
export type RunDrawerState = ReturnType<typeof useRunDrawerState>;

/** The run detail the drawer and its sections read. */
export type RunDetail = ReturnType<typeof useScenarioRunDetail>;

/** The stored run, on a drawer that already has one. */
export type RunScenarioState = NonNullable<RunDetail["scenarioState"]>;

/** How wide the window must be before the results sit beside the conversation. */
export const SIDE_BY_SIDE_MIN_WIDTH = 1100;

/** True when the window gives the side-by-side layout enough room. */
export function useSideBySideLayout(): boolean {
  const [isSideBySide, setIsSideBySide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH,
  );

  useEffect(() => {
    const onResize = () =>
      setIsSideBySide(window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return isSideBySide;
}

/** True once the judge has said something about this run. */
export function hasCriteria(scenarioState: {
  results?: {
    metCriteria?: string[] | null;
    unmetCriteria?: string[] | null;
  } | null;
}): boolean {
  const results = scenarioState.results;
  if (!results) return false;
  return (
    (results.metCriteria?.length ?? 0) + (results.unmetCriteria?.length ?? 0) >
    0
  );
}

/**
 * Reads the stored run once more the moment the run settles.
 *
 * The event that carries the terminal status can beat the write of the
 * results, and a settled run stops polling, so without this the drawer keeps
 * the state it held while the run was still going: no criteria, and no
 * success rate.
 */
function useRereadOnSettled({
  scenarioRunId,
  scenarioState,
  open,
}: {
  scenarioRunId: string | undefined;
  scenarioState: { status: ScenarioRunStatus; results?: unknown } | undefined;
  open: boolean;
}): void {
  const utils = api.useUtils();
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  const isSettledWithoutResults =
    !!scenarioState &&
    isTerminalStatus(scenarioState.status) &&
    !hasCriteria(scenarioState as Parameters<typeof hasCriteria>[0]);

  useEffect(() => {
    if (!open || !scenarioRunId || !isSettledWithoutResults) return;
    const timer = setTimeout(() => {
      void utilsRef.current.scenarios.getRunState.invalidate({ scenarioRunId });
    }, 500);
    return () => clearTimeout(timer);
  }, [open, scenarioRunId, isSettledWithoutResults]);
}

/**
 * The run of the batch, once it exists. A drawer opened at queue time knows
 * only the batch; the batch is read again until the run shows up.
 */
function useResolvedScenarioRunId({ open }: { open: boolean }): {
  scenarioRunId: string | undefined;
  scenarioId: string | undefined;
} {
  const params = useDrawerParams();
  const { project } = useOrganizationTeamProject();
  const needsResolution =
    !params.scenarioRunId && !!params.batchRunId && !!params.scenarioSetId;

  const { data } = api.scenarios.getBatchRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: params.scenarioSetId ?? "",
      batchRunId: params.batchRunId ?? "",
    },
    {
      enabled: open && needsResolution && !!project?.id,
      refetchInterval: (query) => {
        const result = query.state.data;
        const runs = result && "runs" in result ? result.runs : [];
        return runs.length > 0 ? false : 1000;
      },
    },
  );

  const runs = data && "runs" in data ? data.runs : [];
  const resolved =
    runs.find((run) => run.scenarioId === params.scenarioId) ?? runs[0];

  return {
    scenarioRunId: params.scenarioRunId ?? resolved?.scenarioRunId,
    scenarioId: params.scenarioId ?? resolved?.scenarioId,
  };
}

export function useRunDrawerState({ open }: { open: boolean }) {
  const { scenarioRunId, scenarioId: knownScenarioId } =
    useResolvedScenarioRunId({ open });

  const detail = useScenarioRunDetail({ scenarioRunId, open });
  const { scenarioState } = detail;
  const isSideBySide = useSideBySideLayout();

  useRereadOnSettled({ scenarioRunId, scenarioState, open });

  const scenarioVersion =
    scenarioState?.metadata?.langwatch?.scenarioVersion ?? null;

  const openVersionHistory = useCallback(() => {
    const caseId = detail.scenarioId ?? knownScenarioId;
    if (!caseId) return;
    detail.openDrawer("scenarioVersionHistory", {
      urlParams: {
        scenarioId: caseId,
        ...(scenarioVersion != null
          ? { markVersion: String(scenarioVersion) }
          : {}),
      },
    });
  }, [detail, knownScenarioId, scenarioVersion]);

  return {
    scenarioRunId,
    knownScenarioId,
    detail,
    scenarioState,
    scenarioVersion,
    isSideBySide,
    openVersionHistory,
  };
}

/** Whether this run can be stopped from the drawer, and how. */
export function useRunDrawerStop({
  scenarioRunId,
  scenarioState,
}: Pick<RunDrawerState, "scenarioRunId" | "scenarioState">) {
  const { project } = useOrganizationTeamProject();
  const params = useDrawerParams();
  const { can } = useCan();
  const utils = api.useUtils();

  const { cancelJob } = useCancelScenarioRun({
    onCancelJobSuccess: () => void utils.scenarios.getRunState.invalidate(),
  });

  const canStop =
    can("scenarios:manage") &&
    !!params.scenarioSetId &&
    !!scenarioState &&
    isCancellableStatus(scenarioState.status);

  const handleStop = useCallback(() => {
    if (!project?.id || !scenarioState || !scenarioRunId) return;
    cancelJob({
      projectId: project.id,
      scenarioSetId: params.scenarioSetId ?? "",
      batchRunId: params.batchRunId ?? scenarioState.batchRunId,
      scenarioRunId,
      scenarioId: scenarioState.scenarioId,
    });
  }, [project?.id, scenarioState, scenarioRunId, params, cancelJob]);

  return { canStop, handleStop };
}
