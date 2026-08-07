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
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { useCallback, useState } from "react";

import { api } from "~/utils/api";

import type { GovernedSqlParameterValue } from "../logic/governedSqlRequestState";

/** The definition a save writes, assembled from what is on screen. */
export interface WorkbenchChartDraft {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, GovernedSqlParameterValue>>;
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
  readonly save: (input: {
    draft: WorkbenchChartDraft;
    name?: string;
  }) => Promise<void>;
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
    parameters: Readonly<Record<string, GovernedSqlParameterValue>>;
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

  const definitionOf = (draft: WorkbenchChartDraft) => ({
    version: 1 as const,
    sql: draft.sql,
    parameters: draft.parameters,
    ...(draft.vegaLiteSpec ? { vegaLiteSpec: draft.vegaLiteSpec } : {}),
  });

  const save = useCallback(
    async ({ draft, name }: { draft: WorkbenchChartDraft; name?: string }) => {
      const definition = definitionOf(draft);
      try {
        if (opened) {
          await updateChart.mutateAsync({
            projectId,
            id: opened.id,
            definition,
            ...(name === undefined ? {} : { name }),
          });
          if (name !== undefined) setOpened({ id: opened.id, name });
        } else {
          const created = await createChart.mutateAsync({
            projectId,
            name: name ?? "Untitled chart",
            definition,
          });
          setOpened({ id: created.id, name: created.name });
        }
        await refreshList();
      } catch (error) {
        // Rethrowing would leave the workbench with an unhandled rejection and
        // nothing on screen; the caller turns this into registry copy.
        onError(error, "Couldn't save the chart");
      }
    },
    [opened, projectId, createChart, updateChart, refreshList, onError],
  );

  const open = useCallback(
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
          parameters: chart.definition.parameters as Readonly<
            Record<string, GovernedSqlParameterValue>
          >,
          vegaLiteSpec: chart.definition.vegaLiteSpec as
            | Record<string, unknown>
            | undefined,
        });
      } catch (error) {
        onError(error, "Couldn't open the chart");
      }
    },
    [utils, projectId, onOpened, onError],
  );

  const rename = useCallback(
    async ({ id, name }: { id: string; name: string }) => {
      try {
        await updateChart.mutateAsync({ projectId, id, name });
        setOpened((current) =>
          current && current.id === id ? { id, name } : current,
        );
        await refreshList();
      } catch (error) {
        onError(error, "Couldn't rename the chart");
      }
    },
    [projectId, updateChart, refreshList, onError],
  );

  const remove = useCallback(
    async (chartId: string) => {
      try {
        await deleteChart.mutateAsync({ projectId, id: chartId });
        setOpened((current) => (current?.id === chartId ? null : current));
        await refreshList();
      } catch (error) {
        onError(error, "Couldn't delete the chart");
      }
    },
    [projectId, deleteChart, refreshList, onError],
  );

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
