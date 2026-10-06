/**
 * The widgets on the member's boards and the writes a board offers: edit,
 * duplicate, delete and re-layout, over the existing `dashboardWidgets.*`
 * procedures. Failures travel raw to the host (#5984).
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import type { ChartGridPlacement } from "../../../model/chart-grid.ts";
import type { DashboardWidgetDraft } from "../../../model/dashboard-widget-definition.ts";
import { pickerWidgets } from "../catalogue/index.ts";
import type { BlockQuestion } from "../model/block-questions.ts";
import {
  addedWidgetSlots,
  type BoardWidget,
  boardWidgetsOf,
  duplicateSlot,
} from "../model/board-widgets.ts";

export function useBoardWidgets() {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();

  const list = analyticsApi.dashboardWidgets.list.useQuery({ projectId }, { enabled: !!projectId });
  const create = analyticsApi.dashboardWidgets.create.useMutation();
  const update = analyticsApi.dashboardWidgets.update.useMutation();
  const updateLayout = analyticsApi.dashboardWidgets.updateLayout.useMutation();
  const batchUpdateLayouts = analyticsApi.dashboardWidgets.batchUpdateLayouts.useMutation();
  const remove = analyticsApi.dashboardWidgets.delete.useMutation();

  const widgetsOn = (dashboardId: string): BoardWidget[] =>
    boardWidgetsOf({ widgets: list.data ?? [], dashboardId });

  /** Runs one write, reports a failure to the host, and re-reads the board either way. */
  const write = async ({
    fallbackTitle,
    work,
  }: {
    fallbackTitle: string;
    work: () => Promise<void>;
  }): Promise<boolean> => {
    try {
      await work();
      return true;
    } catch (error) {
      host.failed({ error, fallbackTitle });
      return false;
    } finally {
      await utils.dashboardWidgets.list.invalidate({ projectId });
    }
  };

  const duplicateWidget = ({ dashboardId, widget }: { dashboardId: string; widget: BoardWidget }) =>
    write({
      fallbackTitle: "Couldn't duplicate the widget",
      work: async () => {
        const created = await create.mutateAsync({
          projectId,
          dashboardId,
          name: widget.name,
          code: widget.definition.code,
          queries: widget.definition.queries,
        });
        const placements = widgetsOn(dashboardId).map(({ placement }) => placement);
        const slot = duplicateSlot({ placements, original: widget.placement });
        await updateLayout.mutateAsync({ projectId, graphId: created.id, ...slot });
      },
    });

  /**
   * Adds a picked question's widget(s) to the board below what is there, in one
   * layout write, and reports whether they landed so the caller only seeds Langy
   * on success.
   */
  const addQuestionWidgets = ({
    dashboardId,
    question,
  }: {
    dashboardId: string;
    question: BlockQuestion;
  }) =>
    write({
      fallbackTitle: "Couldn't add the block",
      work: async () => {
        const widgets = pickerWidgets(question.id);
        const placements = widgetsOn(dashboardId).map(({ placement }) => placement);
        const slots = addedWidgetSlots({ placements, widgets });
        const layouts = await Promise.all(
          widgets.map(async (widget, index) => {
            const created = await create.mutateAsync({
              projectId,
              dashboardId,
              name: widget.name,
              code: widget.definition.code,
              queries: widget.definition.queries,
            });
            return { graphId: created.id, ...slots[index]! };
          }),
        );
        await batchUpdateLayouts.mutateAsync({ projectId, layouts });
      },
    });

  const saveWidget = ({
    widgetId,
    draft,
    onSaved,
  }: {
    widgetId: string;
    draft: DashboardWidgetDraft;
    onSaved: () => void;
  }) =>
    write({
      fallbackTitle: "Couldn't save the widget",
      work: async () => {
        await update.mutateAsync({ projectId, id: widgetId, ...draft });
        onSaved();
      },
    });

  const removeWidget = ({ widget }: { widget: BoardWidget }) =>
    write({
      fallbackTitle: "Couldn't delete the widget",
      work: async () => {
        await remove.mutateAsync({ projectId, id: widget.id });
      },
    });

  const commitPlacements = (placements: readonly ChartGridPlacement[]) =>
    write({
      fallbackTitle: "Couldn't save the layout",
      work: async () => {
        await batchUpdateLayouts.mutateAsync({ projectId, layouts: [...placements] });
      },
    });

  return {
    widgetsOn,
    status: list.status,
    error: list.error,
    isSaving: update.isPending,
    isWriting:
      create.isPending ||
      update.isPending ||
      updateLayout.isPending ||
      remove.isPending ||
      batchUpdateLayouts.isPending,
    duplicateWidget,
    addQuestionWidgets,
    saveWidget,
    removeWidget,
    commitPlacements,
  };
}
