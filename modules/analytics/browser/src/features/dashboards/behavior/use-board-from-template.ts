/**
 * A new only-me board filled with widgets at their places, then opened: from a template, or
 * a board's own widgets for "Duplicate". No server procedure copies a board, so both reuse
 * the create and widget writes. A failure is reported and the half-made board removed.
 */

import { useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { boardCopyWidgets, boardWidgetsOf } from "../model/board-widgets.ts";
import { boardCopyName, dashboardsPath, templateBoardName } from "../model/boards.ts";
import type { BoardTemplate, BoardTemplateWidget } from "../templates/index.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

/** What a new board is made of; `widgets` is read only once the board is about to be made. */
type BoardSource = {
  id: string;
  name: string;
  description: string | null;
  widgets: () => Promise<readonly BoardTemplateWidget[]>;
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
    dashboardId,
  }: {
    description: string | null;
    widgets: readonly BoardTemplateWidget[];
    dashboardId: string;
  }) => {
    await client.dashboards.updateDetails.mutate({ projectId, dashboardId, description });
    // Independent rows, so the creates run together; the layout lands in one write after.
    const layouts = await Promise.all(
      widgets.map(async ({ name, definition, layout }) => {
        const created = await client.dashboardWidgets.create.mutate({
          projectId,
          dashboardId,
          name,
          code: definition.code,
          queries: definition.queries,
          description: definition.description,
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
  }) => {
    if (creatingId !== void 0) return;
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
        visibility: "only_me",
      });
      dashboardId = board.id;
      await fill({ description: source.description, widgets, dashboardId });
      // Re-read first, so the new board is listed by the time its address opens.
      await refresh();
      host.navigate(dashboardsPath({ projectSlug, dashboardId }));
    } catch (error) {
      host.failed({ error, fallbackTitle });
      if (dashboardId !== void 0) {
        await client.dashboards.delete.mutate({ projectId, dashboardId }).catch(() => {
          // Best effort: a leftover board stays listed and can be deleted by hand.
        });
      }
      await refresh();
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
      source: { ...template, widgets: () => Promise.resolve(template.widgets) },
      existingNames,
      fallbackTitle: "Couldn't create the dashboard from the template",
    });

  /** Copies the board and every widget on it as "<name> copy", then opens the copy. */
  const duplicateBoard = ({
    board,
    existingNames,
  }: {
    board: SavedBoard;
    existingNames: readonly string[];
  }) =>
    createFrom({
      source: {
        id: board.id,
        name: boardCopyName(board.name),
        description: board.description,
        widgets: async () => {
          const stored = await utils.dashboardWidgets.list.fetch({ projectId });
          return boardCopyWidgets(boardWidgetsOf({ widgets: stored, dashboardId: board.id }));
        },
      },
      existingNames,
      fallbackTitle: "Couldn't duplicate the dashboard",
    });

  return { creatingId, createFromTemplate, duplicateBoard };
}
