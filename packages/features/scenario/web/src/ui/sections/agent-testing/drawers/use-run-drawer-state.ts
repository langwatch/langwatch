/**
 * What the Agent Testing run drawer reads: the run behind the address, the
 * layout the window allows, and the version of the case the run used.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useScenarioRunDetail } from "../../simulations/scenario-run-detail-drawer";
import {
  isCancellableStatus,
  useCancelScenarioRun,
} from "../../../../behavior/suites/use-cancel-scenario-run";
import { useCan } from "../../../../behavior/use-can";
import { useDrawerParams } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { isTerminalStatus, ScenarioRunStatus } from "@langwatch/scenario-contract";
import { api } from "../../../../behavior/scenario-api";
import { buildDisplayTitle } from "@langwatch/suite-web";
import { useTargetNameMap } from "../../../../behavior/use-target-name-map";

/** Everything one open drawer knows about the run it is showing. */
export type RunDrawerState = ReturnType<typeof useRunDrawerState>;

/** The run detail the drawer and its sections read. */
export type RunDetail = ReturnType<typeof useScenarioRunDetail>;

/** The stored run, on a drawer that already has one. */
export type RunScenarioState = NonNullable<RunDetail["scenarioState"]>;

/** How wide the drawer opens: the messages, then the results column. */
export const WIDE_DRAWER_WIDTH = 950;

export const WIDE_DRAWER_MAX_WIDTH = `${WIDE_DRAWER_WIDTH}px`;

/** How wide the window must be before the results sit beside the conversation. */
export const SIDE_BY_SIDE_MIN_WIDTH = WIDE_DRAWER_WIDTH;

/** True when the window gives the side-by-side layout enough room. */
export function useSideBySideLayout(): boolean {
  const [isSideBySide, setIsSideBySide] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH,
  );

  useEffect(() => {
    const onResize = () => setIsSideBySide(window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH);
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
  return (results.metCriteria?.length ?? 0) + (results.unmetCriteria?.length ?? 0) > 0;
}

/**
 * True once the judge has spoken: criteria, a verdict, a reasoning or an error.
 *
 * A verdict is a verdict with no criteria under it. A scripted run, such as the
 * ping an agent test sends, is judged by its script and answers with a verdict
 * and a reasoning alone. The pending line and the reread both read this, so a
 * scripted run stops asking for results it already holds.
 */
export function hasVerdict(scenarioState: {
  results?: {
    metCriteria?: string[] | null;
    unmetCriteria?: string[] | null;
    error?: unknown;
    verdict?: unknown;
    reasoning?: unknown;
  } | null;
}): boolean {
  const results = scenarioState.results;
  if (!results) return false;
  return (
    hasCriteria(scenarioState) ||
    Boolean(results.error) ||
    Boolean(results.verdict) ||
    Boolean(results.reasoning)
  );
}

/**
 * How long to wait before each reread of a settled run. The list also sets
 * how many rereads there are: once it runs out, the drawer stops asking.
 */
const SETTLED_REREAD_DELAYS_MS = [500, 1_000, 2_000, 4_000];

/**
 * Reads the stored run again after the run settles, until the results arrive.
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
    !hasVerdict(scenarioState as Parameters<typeof hasVerdict>[0]);

  const [rereadCount, setRereadCount] = useState(0);

  useEffect(() => {
    setRereadCount(0);
  }, [scenarioRunId, open]);

  useEffect(() => {
    if (!open || !scenarioRunId || !isSettledWithoutResults) return;
    const delay = SETTLED_REREAD_DELAYS_MS[rereadCount];
    if (delay === undefined) return;
    const timer = setTimeout(() => {
      void utilsRef.current.scenarios.getRunState.invalidate({ scenarioRunId });
      setRereadCount((count) => count + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [open, scenarioRunId, isSettledWithoutResults, rereadCount]);
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
  const needsResolution = !params.scenarioRunId && !!params.batchRunId && !!params.scenarioSetId;

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

  const runs: { scenarioId?: string; scenarioRunId?: string }[] =
    data && "runs" in data ? data.runs : [];
  const resolved = runs.find((run) => run.scenarioId === params.scenarioId) ?? runs[0];

  return {
    scenarioRunId: params.scenarioRunId ?? resolved?.scenarioRunId,
    scenarioId: params.scenarioId ?? resolved?.scenarioId,
  };
}

/**
 * The run the drawer reads before its record exists.
 *
 * A run of one scenario opens the drawer the moment it is queued, and the
 * record lands a moment later. Without a stand-in the drawer would draw a
 * bare "Queued" line first and the whole layout after it, so the reader
 * watches the drawer build itself. The stand-in carries what is true at that
 * moment and nothing more: the run is queued, it holds no message, and it has
 * no verdict.
 */
function queuedRunStandIn({
  scenarioId,
  batchRunId,
}: {
  scenarioId: string | undefined;
  batchRunId: string | undefined;
}): RunScenarioState {
  return {
    scenarioId: scenarioId ?? "",
    batchRunId: batchRunId ?? "",
    scenarioRunId: "",
    status: ScenarioRunStatus.QUEUED,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
  };
}

/**
 * The detail the drawer draws: the stored run, or the queued stand-in while
 * the record is still on its way.
 *
 * The scenario is read here rather than through the stream, because the
 * stream learns the scenario id from the run it does not have yet.
 */
function useDrawerDetail({
  detail,
  scenarioId,
  open,
}: {
  detail: RunDetail;
  scenarioId: string | undefined;
  open: boolean;
}): RunDetail {
  const { project } = useOrganizationTeamProject();
  const params = useDrawerParams();
  const targetNameMap = useTargetNameMap();
  // NOT_FOUND is the ordinary answer while a run is queued, since the record
  // is written after the job goes out. Only a read that truly failed stops
  // the stand-in.
  const isQueued = open && !detail.scenarioState && !isHardReadError(detail.runStateError);

  const { data: queuedScenario } = api.scenarios.getByIdIncludingArchived.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: isQueued && !!project?.id && !!scenarioId },
  );

  if (!isQueued) return detail;

  return {
    ...detail,
    scenarioState: queuedRunStandIn({
      scenarioId,
      batchRunId: params.batchRunId,
    }),
    scenarioData: queuedScenario,
    // The run has recorded no target yet, so the address it was opened from
    // is what names it. The title then reads the same before and after the
    // record lands.
    displayTitle: buildDisplayTitle({
      scenarioName: queuedScenario?.name ?? "",
      targetName: params.targetId ? (targetNameMap.get(params.targetId) ?? null) : null,
      iteration: undefined,
    }),
  };
}

export function useRunDrawerState({ open }: { open: boolean }) {
  const { scenarioRunId, scenarioId: knownScenarioId } = useResolvedScenarioRunId({ open });

  const storedDetail = useScenarioRunDetail({ scenarioRunId, open });
  const scenarioState = storedDetail.scenarioState;
  const detail = useDrawerDetail({
    detail: storedDetail,
    scenarioId: knownScenarioId,
    open,
  });
  const isSideBySide = useSideBySideLayout();

  useRereadOnSettled({ scenarioRunId, scenarioState, open });

  const scenarioVersion = scenarioState?.metadata?.langwatch?.scenarioVersion ?? null;

  return {
    scenarioRunId,
    knownScenarioId,
    /** The run to draw: the stored one, or the queued stand-in. */
    detail,
    /** The stored run alone. Absent while the run is only queued. */
    scenarioState,
    scenarioVersion,
    isSideBySide,
    /** True while the run-state read is still on its way. */
    isReadingRun: storedDetail.isRunStateLoading && !storedDetail.runStateError,
    /** True when the run-state read failed for a reason other than a run that does not exist yet. */
    readFailed: isHardReadError(storedDetail.runStateError),
  };
}

/**
 * True when a run-state read failed for a reason the reader must see.
 *
 * A run that is not found is the ordinary case while a run is queued: the
 * record is written after the job goes out, so NOT_FOUND means "not yet".
 */
export function isHardReadError(error: unknown): boolean {
  if (!error) return false;
  return (error as { data?: { code?: string } }).data?.code !== "NOT_FOUND";
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
