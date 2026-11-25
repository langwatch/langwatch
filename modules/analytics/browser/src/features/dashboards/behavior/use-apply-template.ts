/**
 * A template picked on an empty board fills that board rather than making another: its widgets
 * land in the template's places, an untitled board takes the template's name and a board with no
 * description its job. As a new board's first edit it stores the board (AC162); Langy then
 * drafts the template's report, unsent (AC140). */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { useLangyAsk } from "../langy/behavior/use-board-langy.ts";
import { boardPromptDraft, boardSubject } from "../langy/model/board-langy.ts";
import { isUntitledBoardName, templateBoardName } from "../model/boards.ts";
import { widgetAdded } from "../model/dashboard-usage-events.ts";
import type { BoardTemplate } from "../templates/index.ts";
import { placeTemplateWidgets } from "./use-board-from-template.ts";
import type { UnsavedBoard } from "./use-board-header-edits.ts";
import { useBoardPeriod } from "./use-board-period.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

/** What the template changes on the board beside its widgets: its name and its description. */
function boardEdit({
  board,
  template,
  takenNames,
}: {
  board: SavedBoard;
  template: BoardTemplate;
  takenNames: readonly string[];
}): { name?: string; description?: string } {
  const others = takenNames.filter((name) => name !== board.name);
  return {
    ...(isUntitledBoardName(board.name)
      ? { name: templateBoardName({ templateName: template.name, existingNames: others }) }
      : {}),
    ...(board.description ? {} : { description: template.description }),
  };
}

export function useApplyTemplate({
  board,
  unsaved,
  takenNames,
}: {
  board: SavedBoard;
  unsaved: UnsavedBoard | undefined;
  /** The names of the boards beside it, so the template's name is numbered past them. */
  takenNames: readonly string[];
}) {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const utils = analyticsApi.useUtils();
  const langy = useLangyAsk();
  const { period } = useBoardPeriod();
  const projectId = host.project()?.id ?? "";
  const [applyingId, setApplyingId] = useState<string | undefined>();

  /** A new board is stored with the edit; a stored one takes it once its widgets landed. */
  const fill = async ({
    template,
    edit,
  }: {
    template: BoardTemplate;
    edit: ReturnType<typeof boardEdit>;
  }) => {
    const { client } = utils;
    const widgets = template.widgets;
    if (unsaved) {
      const dashboardId = await unsaved.materialise({ ...edit, templateId: template.id });
      await placeTemplateWidgets({ client, projectId, dashboardId, widgets });
      return dashboardId;
    }
    const placed = await placeTemplateWidgets({
      client,
      projectId,
      dashboardId: board.id,
      widgets,
    });
    if (edit.name !== void 0 || edit.description !== void 0) {
      // A refused name or description takes the widgets back out: the template lands whole or not.
      await client.boards.update
        .mutate({ projectId, dashboardId: board.id, ...edit })
        .catch(async (error: unknown) => {
          await Promise.all(
            placed.map((id) =>
              client.dashboardWidgets.delete.mutate({ projectId, id }).catch(() => void 0),
            ),
          );
          throw error;
        });
    }
    analytics.track(
      widgetAdded({ addedFrom: "template", addedCount: widgets.length, templateId: template.id }),
    );
    return board.id;
  };

  const apply = async (template: BoardTemplate) => {
    if (applyingId !== void 0 || projectId === "") return;
    setApplyingId(template.id);
    const edit = boardEdit({ board, template, takenNames });
    try {
      const dashboardId = await fill({ template, edit });
      if (!langy.enabled || !template.reportPrompt) return;
      const subject = boardSubject({
        board: { id: dashboardId, name: edit.name ?? board.name },
        widgets: template.widgets,
      });
      langy.ask(boardPromptDraft({ prompt: template.reportPrompt, board: subject, period }));
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't add the template to this dashboard" });
    } finally {
      // On every exit, so the board shows each write that landed before another try.
      await Promise.all([
        utils.dashboardWidgets.list.invalidate({ projectId }),
        utils.boards.getAll.invalidate({ projectId }),
        utils.boards.listInOrganization.invalidate(),
      ]);
      setApplyingId(void 0);
    }
  };

  return {
    /** The template being applied, while one is. */
    applyingId,
    apply,
  };
}
