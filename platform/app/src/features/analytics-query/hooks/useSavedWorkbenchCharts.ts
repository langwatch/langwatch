/**
 * Saving and reopening the chart a member built in the workbench.
 *
 * Holds one piece of state of its own — which saved chart is open — and that is
 * what makes Save mean two different things honestly: with a chart open it
 * writes back to that chart, and with none open it creates one. A workbench
 * that always created would leave a member who pressed Save twice with two
 * charts and no way to tell which the dashboard is showing.
 *
 * Returns state and callbacks, never JSX.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";

import { api } from "~/utils/api";

import type { LangWatchQLParameterValue } from "../logic/lwqlRequestState";

/** The definition a save writes, assembled from what is on screen. */
export interface WorkbenchChartDraft {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, LangWatchQLParameterValue>>;
  /**
   * The specification the member is looking at, when they have opened the
   * chart at all. Absent saves the query alone — which is a whole record, not
   * a broken one: the workbench derives a starter specification from the
   * result shape when such a chart is opened.
   */
  readonly vegaLiteSpec?: Record<string, unknown>;
}

/** A saved chart as the toolbar lists it. */
export interface SavedChartSummary {
  readonly id: string;
  readonly name: string;
}

export interface UseSavedWorkbenchCharts {
  readonly charts: readonly SavedChartSummary[];
  readonly isLoading: boolean;
  /** The chart Save writes back to, or `null` when nothing is open. */
  readonly openedChartId: string | null;
  readonly openedChartName: string | null;
  readonly isSaving: boolean;
  /** Writes to the open chart, or creates one under `name`. */
  readonly save: (input: { draft: WorkbenchChartDraft; name?: string }) => Promise<void>;
  /** Loads a saved chart and hands its definition to the caller to apply. */
  readonly open: (chartId: string) => Promise<void>;
  readonly rename: (input: { id: string; name: string }) => Promise<void>;
  readonly remove: (chartId: string) => Promise<void>;
  /** Forgets which chart is open, so the next Save creates a new one. */
  readonly closeOpened: () => void;
}

export function useSavedWorkbenchCharts({
  projectId,
  onOpened,
  onError,
}: {
  projectId: string;
  /**
   * Applies a loaded chart to the workbench. Called with the saved definition;
   * the hook never touches the editor itself.
   */
  onOpened: (opened: {
    id: string;
    name: string;
    sql: string;
    parameters: Readonly<Record<string, LangWatchQLParameterValue>>;
    vegaLiteSpec: Record<string, unknown> | undefined;
  }) => void;
  /** Where a refusal goes. The caller renders registry copy from its `code`. */
  onError: (error: unknown, fallbackTitle: string) => void;
}): UseSavedWorkbenchCharts {
  const utils = api.useUtils();
  const [opened, setOpened] = useState<SavedChartSummary | null>(null);

  const list = api.analytics.savedWorkbenchCharts.getAll.useQuery(
    { projectId },
    // No refetch interval anywhere: the workbench talks to the server when the
    // member asks it to, and a saved-chart list is not an exception.
    { enabled: projectId.length > 0 },
  );

  const createChart = api.analytics.savedWorkbenchCharts.create.useMutation();
  const updateChart = api.analytics.savedWorkbenchCharts.update.useMutation();
  const deleteChart = api.analytics.savedWorkbenchCharts.delete.useMutation();

  const refreshList = useCallback(async () => {
    await utils.analytics.savedWorkbenchCharts.getAll.invalidate({ projectId });
  }, [utils, projectId]);

  const writes = { projectId, setOpened, refreshList, onError };
  const save = useSaveChart({ ...writes, opened, createChart, updateChart });
  const open = useOpenChart({ ...writes, utils, onOpened });
  const rename = useRenameChart({ ...writes, updateChart });
  const remove = useRemoveChart({ ...writes, deleteChart });

  return {
    charts: list.data ?? [],
    isLoading: list.isLoading,
    openedChartId: opened?.id ?? null,
    openedChartName: opened?.name ?? null,
    isSaving: createChart.isPending || updateChart.isPending,
    save,
    open,
    rename,
    remove,
    closeOpened: useCallback(() => setOpened(null), []),
  };
}

/** What every write shares: the project, the opened-chart state, the list, and where refusals go. */
interface ChartWriteContext {
  projectId: string;
  setOpened: Dispatch<SetStateAction<SavedChartSummary | null>>;
  refreshList: () => Promise<void>;
  onError: (error: unknown, fallbackTitle: string) => void;
}

function definitionOf(draft: WorkbenchChartDraft) {
  return {
    version: 1 as const,
    sql: draft.sql,
    parameters: draft.parameters,
    ...(draft.vegaLiteSpec ? { vegaLiteSpec: draft.vegaLiteSpec } : {}),
  };
}

type CreateChartMutation = ReturnType<
  typeof api.analytics.savedWorkbenchCharts.create.useMutation
>;
type UpdateChartMutation = ReturnType<
  typeof api.analytics.savedWorkbenchCharts.update.useMutation
>;

async function writeBackToOpened({
  projectId,
  opened,
  name,
  definition,
  updateChart,
  setOpened,
}: {
  projectId: string;
  opened: SavedChartSummary;
  name: string | undefined;
  definition: ReturnType<typeof definitionOf>;
  updateChart: UpdateChartMutation;
  setOpened: Dispatch<SetStateAction<SavedChartSummary | null>>;
}): Promise<void> {
  await updateChart.mutateAsync({
    projectId,
    id: opened.id,
    definition,
    ...(name === undefined ? {} : { name }),
  });
  if (name !== undefined) setOpened({ id: opened.id, name });
}

async function createNewChart({
  projectId,
  name,
  definition,
  createChart,
  setOpened,
}: {
  projectId: string;
  name: string | undefined;
  definition: ReturnType<typeof definitionOf>;
  createChart: CreateChartMutation;
  setOpened: Dispatch<SetStateAction<SavedChartSummary | null>>;
}): Promise<void> {
  const created = await createChart.mutateAsync({
    projectId,
    name: name ?? "Untitled chart",
    definition,
  });
  setOpened({ id: created.id, name: created.name });
}

function useSaveChart({
  projectId,
  opened,
  setOpened,
  refreshList,
  onError,
  createChart,
  updateChart,
}: ChartWriteContext & {
  opened: SavedChartSummary | null;
  createChart: CreateChartMutation;
  updateChart: UpdateChartMutation;
}) {
  // Set synchronously at entry, which `isSaving` cannot be: that flag is React
  // state off `isPending`, so two Saves in one tick both read its pre-render
  // value, both see no chart open, and both create — the duplicate this module
  // exists to prevent. Disabling the button is still worth doing; it just
  // cannot serialise the calls, so the refusal has to live here.
  const inFlight = useRef(false);

  return useCallback(
    async ({ draft, name }: { draft: WorkbenchChartDraft; name?: string }) => {
      // Dropped rather than queued: a second Save on an unchanged draft is a
      // double-click, and running it again would write the same bytes twice.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const definition = definitionOf(draft);
        try {
          if (opened) {
            await writeBackToOpened({
              projectId,
              opened,
              name,
              definition,
              updateChart,
              setOpened,
            });
          } else {
            await createNewChart({
              projectId,
              name,
              definition,
              createChart,
              setOpened,
            });
          }
        } catch (error) {
          // Rethrowing would leave the workbench with an unhandled rejection
          // and nothing on screen; the caller turns this into registry copy.
          onError(error, "Couldn't save the chart");
          return;
        }

        // Outside the write's catch on purpose: the chart is already saved by
        // this point, and reporting a failed refresh as a failed save sends the
        // member back to press Save again, creating a duplicate.
        try {
          await refreshList();
        } catch (error) {
          onError(error, "Saved, but the chart list didn't refresh");
        }
      } finally {
        // Held across the refresh too, not just the write: `setOpened` is state
        // as well, so releasing at write-end would let a Save arriving before
        // the re-render still read `opened` as null and create a second chart.
        inFlight.current = false;
      }
    },
    [opened, projectId, createChart, updateChart, setOpened, refreshList, onError],
  );
}

function useOpenChart({
  projectId,
  setOpened,
  onError,
  utils,
  onOpened,
}: ChartWriteContext & {
  utils: ReturnType<typeof api.useUtils>;
  onOpened: Parameters<typeof useSavedWorkbenchCharts>[0]["onOpened"];
}) {
  return useCallback(
    async (chartId: string) => {
      try {
        const chart = await utils.analytics.savedWorkbenchCharts.getById.fetch({
          projectId,
          id: chartId,
        });
        setOpened({ id: chart.id, name: chart.name });
        onOpened({
          id: chart.id,
          name: chart.name,
          sql: chart.definition.sql,
          parameters: chart.definition.parameters,
          vegaLiteSpec: chart.definition.vegaLiteSpec,
        });
      } catch (error) {
        onError(error, "Couldn't open the chart");
      }
    },
    [utils, projectId, setOpened, onOpened, onError],
  );
}

function useRenameChart({
  projectId,
  setOpened,
  refreshList,
  onError,
  updateChart,
}: ChartWriteContext & {
  updateChart: ReturnType<typeof api.analytics.savedWorkbenchCharts.update.useMutation>;
}) {
  return useCallback(
    async ({ id, name }: { id: string; name: string }) => {
      try {
        await updateChart.mutateAsync({ projectId, id, name });
        setOpened((current) => (current && current.id === id ? { id, name } : current));
      } catch (error) {
        onError(error, "Couldn't rename the chart");
        return;
      }

      // The rename landed; only the list is behind. Same reason as the save
      // path: a stale list must not read as work that did not happen.
      try {
        await refreshList();
      } catch (error) {
        onError(error, "Renamed, but the chart list didn't refresh");
      }
    },
    [projectId, updateChart, setOpened, refreshList, onError],
  );
}

function useRemoveChart({
  projectId,
  setOpened,
  refreshList,
  onError,
  deleteChart,
}: ChartWriteContext & {
  deleteChart: ReturnType<typeof api.analytics.savedWorkbenchCharts.delete.useMutation>;
}) {
  return useCallback(
    async (chartId: string) => {
      try {
        await deleteChart.mutateAsync({ projectId, id: chartId });
        setOpened((current) => (current?.id === chartId ? null : current));
      } catch (error) {
        onError(error, "Couldn't delete the chart");
        return;
      }

      // Deleted on the server. Reporting a refresh failure as a failed delete
      // invites a second attempt at a chart that is already gone.
      try {
        await refreshList();
      } catch (error) {
        onError(error, "Deleted, but the chart list didn't refresh");
      }
    },
    [projectId, deleteChart, setOpened, refreshList, onError],
  );
}
