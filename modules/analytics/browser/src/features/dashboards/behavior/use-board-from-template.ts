/**
 * A new board for the whole project, filled and opened: from a template, "Duplicate" or
 * "Duplicate to edit". No procedure copies a board; a failure removes the half-made one.
 */

import type { DashboardWidgetSource } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { boardCopyWidgets, boardWidgetsOf } from "../model/board-widgets.ts";
import {
  boardCopyName,
  curatedCopyName,
  dashboardsPath,
  templateBoardName,
} from "../model/boards.ts";
import type { CuratedBoard } from "../model/curated-boards.ts";
import { catalogueSource } from "../model/widget-source.ts";
import type { BoardTemplate, BoardTemplateWidget } from "../templates/index.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

/** What a new board is made of; `widgets` is read only once the board is about to be made. */
type BoardSource = {
  id: string;
  name: string;
  description: string | null;
  widgets: () => Promise<readonly BoardTemplateWidget[]>;
  /** Where each new widget says it came from: its catalogue widget, or the copied one's. */
  widgetSource: (widget: BoardTemplateWidget) => DashboardWidgetSource | undefined;
};

/** A template's widgets are catalogue widgets, keyed by their catalogue id. */
const fromCatalogue = (widget: BoardTemplateWidget) => catalogueSource(widget.key);

/** The board just made and opened, for what follows it, such as a Langy draft. */
export type CreatedBoard = {
  id: string;
  name: string;
  widgets: readonly BoardTemplateWidget[];
};

export function useBoardFromTemplate() {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const projectSlug = project?.slug ?? "";
  const utils = analyticsApi.useUtils();
  const { client } = utils;
  const [creatingId, setCreatingId] = useState<string | undefined>();

  const fill = async ({
    description,
    widgets,
    widgetSource,
    dashboardId,
  }: {
    description: string | null;
    widgets: readonly BoardTemplateWidget[];
    widgetSource: BoardSource["widgetSource"];
    dashboardId: string;
  }) => {
    await client.dashboards.updateDetails.mutate({ projectId, dashboardId, description });
    // Independent rows, so the creates run together; the layout lands in one write after.
    const layouts = await Promise.all(
      widgets.map(async (widget) => {
        const { name, definition, layout } = widget;
        const created = await client.dashboardWidgets.create.mutate({
          projectId,
          dashboardId,
          name,
          code: definition.code,
          queries: definition.queries,
          description: definition.description,
          prompt: definition.prompt,
          source: widgetSource(widget),
        });
        return { graphId: created.id, ...layout };
      }),
    );
    await client.dashboardWidgets.batchUpdateLayouts.mutate({ projectId, layouts });
  };

  const createFrom = async ({
    source,
    existingNames,
    fallbackTitle,
  }: {
    source: BoardSource;
    existingNames: readonly string[];
    fallbackTitle: string;
  }): Promise<CreatedBoard | undefined> => {
    if (creatingId !== void 0) return void 0;
    setCreatingId(source.id);
    const refresh = () =>
      Promise.all([
        utils.dashboards.getAll.invalidate({ projectId }),
        utils.dashboardWidgets.list.invalidate({ projectId }),
      ]);
    let dashboardId: string | undefined;
    try {
      const widgets = await source.widgets();
      const board = await client.dashboards.create.mutate({
        projectId,
        name: templateBoardName({ templateName: source.name, existingNames }),
      });
      dashboardId = board.id;
      await fill({
        description: source.description,
        widgets,
        widgetSource: source.widgetSource,
        dashboardId,
      });
      // Re-read first, so the new board is listed by the time its address opens.
      await refresh();
      host.navigate(dashboardsPath({ projectSlug, dashboardId }));
      return { id: board.id, name: board.name, widgets };
    } catch (error) {
      host.failed({ error, fallbackTitle });
      if (dashboardId !== void 0) {
        await client.dashboards.delete.mutate({ projectId, dashboardId }).catch(() => {
          // Best effort: a leftover board stays listed and can be deleted by hand.
        });
      }
      await refresh();
      return void 0;
    } finally {
      setCreatingId(void 0);
    }
  };

  const createFromTemplate = ({
    template,
    existingNames,
  }: {
    template: BoardTemplate;
    existingNames: readonly string[];
  }) =>
    createFrom({
      source: {
        ...template,
        widgets: () => Promise.resolve(template.widgets),
        widgetSource: fromCatalogue,
      },
      existingNames,
      fallbackTitle: "Couldn't create the dashboard from the template",
    });

  /** Copies the board and every widget on it as "<name> copy", then opens the copy. */
  const duplicateBoard = ({
    board,
    existingNames,
  }: {
    board: Pick<SavedBoard, "id" | "name" | "description">;
    existingNames: readonly string[];
  }) =>
    createFrom({
      source: {
        id: board.id,
        name: boardCopyName(board.name),
        description: board.description,
        widgetSource: ({ definition }) => definition.source,
        widgets: async () => {
          const stored = await utils.dashboardWidgets.list.fetch({ projectId });
          return boardCopyWidgets(boardWidgetsOf({ widgets: stored, dashboardId: board.id }));
        },
      },
      existingNames,
      fallbackTitle: "Couldn't duplicate the dashboard",
    });

  /** "Duplicate to edit": the From LangWatch board's built widgets as "<name> (copy)". */
  const duplicateCurated = ({
    board,
    existingNames,
  }: {
    board: CuratedBoard;
    existingNames: readonly string[];
  }) =>
    createFrom({
      source: {
        id: board.templateId,
        name: curatedCopyName(board.name),
        description: board.job,
        widgets: () => Promise.resolve([...board.widgets]),
        widgetSource: fromCatalogue,
      },
      existingNames,
      fallbackTitle: "Couldn't duplicate the dashboard",
    });

  return { creatingId, createFromTemplate, duplicateBoard, duplicateCurated };
}
