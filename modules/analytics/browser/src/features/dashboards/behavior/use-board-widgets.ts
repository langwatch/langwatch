/**
 * One board's widgets and every change to them over `dashboardWidgets.*`. A pick shows and a
 * delete hides at once, rolled back if refused; every change offers Undo, which writes the
 * board back as it was. Failures travel raw to the host (#5984).
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import type { DashboardWidgetSource } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { startTransition, useRef, useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import type { ChartGridPlacement } from "../../../model/chart-grid.ts";
import type {
  DashboardWidgetDefinition,
  DashboardWidgetDraft,
} from "../../../model/dashboard-widget-definition.ts";
import { pickerWidgets } from "../catalogue/index.ts";
import { blankWidgetSlot } from "../model/blank-widget.ts";
import { atLeastBoardMinRows } from "../model/board-grid.ts";
import { boardRestorePlan } from "../model/board-restore.ts";
import {
  addedWidgetSlots,
  type BoardWidget,
  boardWidgetsOf,
  duplicateSlot,
} from "../model/board-widgets.ts";
import type { WidgetQuestion } from "../model/widget-questions.ts";
import { CODE_SOURCE, catalogueSource } from "../model/widget-source.ts";
import { offerUndo, withdrawUndo } from "./widget-undo.ts";

/** What a new widget is made from: its name, its stored parts and where it came from. */
type NewWidget = {
  name: string;
  definition: Pick<DashboardWidgetDefinition, "code" | "queries" | "description" | "prompt">;
  source: DashboardWidgetSource | undefined;
};

/** The hidden ids with one widget hidden, or shown again. */
function withHidden({
  ids,
  id,
  hidden,
}: {
  ids: ReadonlySet<string>;
  id: string;
  hidden: boolean;
}): ReadonlySet<string> {
  const next = new Set(ids);
  if (hidden) next.add(id);
  else next.delete(id);
  return next;
}

export function useBoardWidgets({ dashboardId }: { dashboardId: string }) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();

  const list = analyticsApi.dashboardWidgets.list.useQuery({ projectId }, { enabled: !!projectId });
  const create = analyticsApi.dashboardWidgets.create.useMutation();
  const update = analyticsApi.dashboardWidgets.update.useMutation();
  const updateLayout = analyticsApi.dashboardWidgets.updateLayout.useMutation();
  const batchUpdateLayouts = analyticsApi.dashboardWidgets.batchUpdateLayouts.useMutation();
  const remove = analyticsApi.dashboardWidgets.delete.useMutation();

  // Shown before the server has them, and hidden before the server has dropped them.
  const [pending, setPending] = useState<readonly BoardWidget[]>([]);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const pendingCount = useRef(0);
  const stored = boardWidgetsOf({ widgets: list.data ?? [], dashboardId }).filter(
    ({ id }) => !hiddenIds.has(id),
  );
  const widgets = [...stored, ...pending];
  const placements = widgets.map(({ placement }) => placement);
  const setHidden = ({ id, hidden }: { id: string; hidden: boolean }) =>
    setHiddenIds((ids) => withHidden({ ids, id, hidden }));

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

  const createWidget = async ({ name, definition, source }: NewWidget): Promise<string> => {
    const created = await create.mutateAsync({
      projectId,
      dashboardId,
      name,
      code: definition.code,
      queries: definition.queries,
      description: definition.description,
      prompt: definition.prompt,
      source,
    });
    return created.id;
  };

  /** Puts the board back as `before` had it, against what the server holds now. */
  const restore = (before: readonly BoardWidget[]) =>
    write({
      fallbackTitle: "Couldn't undo the change",
      work: async () => {
        const stored = await utils.dashboardWidgets.list.fetch({ projectId });
        const plan = boardRestorePlan({
          before,
          now: boardWidgetsOf({ widgets: stored, dashboardId }),
        });
        await Promise.all(plan.remove.map((id) => remove.mutateAsync({ projectId, id })));
        await Promise.all(
          plan.revert.map(({ id, name, definition }) =>
            update.mutateAsync({
              projectId,
              id,
              name,
              code: definition.code,
              queries: definition.queries,
            }),
          ),
        );
        const recreated = await Promise.all(
          plan.recreate.map(async ({ name, definition, placement }) => ({
            ...placement,
            graphId: await createWidget({ name, definition, source: definition.source }),
          })),
        );
        const layouts = [...plan.layouts, ...recreated];
        if (layouts.length > 0) await batchUpdateLayouts.mutateAsync({ projectId, layouts });
      },
    });

  /** A change that, once it lands, offers to put the board back as it is now. */
  const undoable = async ({
    title,
    change,
  }: {
    title: string;
    change: () => Promise<boolean>;
  }): Promise<boolean> => {
    const before = stored;
    const done = await change();
    if (done) offerUndo({ title, undo: () => void restore(before) });
    return done;
  };

  const duplicateWidget = (widget: BoardWidget) =>
    undoable({
      title: "Widget duplicated",
      change: () =>
        write({
          fallbackTitle: "Couldn't duplicate the widget",
          work: async () => {
            const graphId = await createWidget({
              name: widget.name,
              definition: widget.definition,
              source: widget.definition.source,
            });
            const slot = duplicateSlot({ placements, original: widget.placement });
            await updateLayout.mutateAsync({ projectId, graphId, ...slot });
          },
        }),
    });

  /**
   * Adds a picked question's widget(s) below what is there, in one layout write. They show on
   * the board at once and read their data while the write runs; on a refusal they go again.
   * Resolves whether they landed, so the caller only seeds Langy on success.
   */
  const addQuestionWidgets = async (question: WidgetQuestion) => {
    const picked = pickerWidgets(question.id);
    const slots = addedWidgetSlots({ placements, widgets: picked });
    const shown: BoardWidget[] = picked.map((widget, index) => {
      pendingCount.current += 1;
      const id = `pending-${pendingCount.current}`;
      return {
        id,
        name: widget.name,
        definition: widget.definition,
        placement: { graphId: id, ...slots[index]! },
      };
    });
    // A transition, so whatever closed with the pick paints before the board draws these.
    startTransition(() => setPending((now) => [...now, ...shown]));
    try {
      return await undoable({
        title: "Widget added",
        change: () =>
          write({
            fallbackTitle: "Couldn't add the widget",
            work: async () => {
              const layouts = await Promise.all(
                picked.map(async (widget, index) => ({
                  graphId: await createWidget({
                    name: widget.name,
                    definition: widget.definition,
                    source: catalogueSource(widget.key),
                  }),
                  ...slots[index]!,
                })),
              );
              await batchUpdateLayouts.mutateAsync({ projectId, layouts });
            },
          }),
      });
    } finally {
      // After the re-read, so the stored widgets take their place with no gap between.
      setPending((now) => now.filter((widget) => !shown.includes(widget)));
    }
  };

  /** Saves a widget written in the editor, such as a new one from scratch, at the bottom. */
  const addWidget = (draft: DashboardWidgetDraft) =>
    undoable({
      title: "Widget added",
      change: () =>
        write({
          fallbackTitle: "Couldn't add the widget",
          work: async () => {
            const graphId = await createWidget({
              name: draft.name,
              definition: draft,
              source: CODE_SOURCE,
            });
            await updateLayout.mutateAsync({ projectId, graphId, ...blankWidgetSlot(placements) });
          },
        }),
    });

  const saveWidget = ({ widget, draft }: { widget: BoardWidget; draft: DashboardWidgetDraft }) =>
    undoable({
      title: "Widget saved",
      change: () =>
        write({
          fallbackTitle: "Couldn't save the widget",
          work: async () => {
            await update.mutateAsync({ projectId, id: widget.id, ...draft });
          },
        }),
    });

  /**
   * Deletes a widget off the board at once, with Undo straight away. Undo waits for the delete
   * to land before writing the board back; a refused delete brings the widget back, takes the
   * Undo away and says why.
   */
  const removeWidget = async (widget: BoardWidget): Promise<boolean> => {
    const before = stored;
    setHidden({ id: widget.id, hidden: true });
    const removal = write({
      fallbackTitle: "Couldn't delete the widget",
      work: async () => {
        await remove.mutateAsync({ projectId, id: widget.id });
      },
    });
    const toastId = offerUndo({
      title: "Widget deleted",
      undo: () => void removal.then((done) => done && restore(before)),
    });
    const done = await removal;
    setHidden({ id: widget.id, hidden: false });
    if (!done) withdrawUndo(toastId);
    return done;
  };

  const commitPlacements = (next: readonly ChartGridPlacement[]) =>
    undoable({
      title: "Layout saved",
      change: () =>
        write({
          fallbackTitle: "Couldn't save the layout",
          work: async () => {
            await batchUpdateLayouts.mutateAsync({
              projectId,
              layouts: next.map(atLeastBoardMinRows),
            });
          },
        }),
    });

  return {
    widgets,
    status: list.status,
    error: list.error,
    isSaving: create.isPending || update.isPending,
    isWriting:
      create.isPending ||
      update.isPending ||
      updateLayout.isPending ||
      remove.isPending ||
      batchUpdateLayouts.isPending,
    duplicateWidget,
    addQuestionWidgets,
    addWidget,
    saveWidget,
    removeWidget,
    commitPlacements,
  };
}
