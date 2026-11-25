/**
 * The first change to a From LangWatch board asks first; "Yes, modify it" makes the member's own
 * copy with that change, takes over its pin and opens it where the change goes on. A failed copy
 * leaves the member on the board, told why. @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { DashboardProject } from "@langwatch/dashboard-contract";
import { useState } from "react";

import type { CuratedBoard } from "../model/curated-boards.ts";
import { type CuratedEdit, changesCurated, curatedCopySource } from "../model/curated-edits.ts";
import { withBlockPickerOpen } from "./use-block-picker-address.ts";
import { useBoardFromTemplate } from "./use-board-from-template.ts";
import { useFavourites } from "./use-favourites.ts";
import { withWidgetEditorOpen } from "./use-widget-editor-address.ts";

/** Where the copy opens so the change the member started goes on there. */
function landingFor({ board, edit }: { board: CuratedBoard; edit: CuratedEdit }) {
  return ({ path, widgetIds }: { path: string; widgetIds: readonly string[] }) => {
    if (edit.kind === "addWidget") return withBlockPickerOpen(path);
    if (edit.kind !== "editWidget") return path;
    const target = widgetIds[board.widgets.findIndex(({ key }) => key === edit.key)];
    return target === void 0 ? path : withWidgetEditorOpen({ path, target });
  };
}

export function useModifyCurated({
  board,
  atOrganization = false,
  storeProject,
  existingNames,
}: {
  board: CuratedBoard;
  atOrganization?: boolean;
  storeProject?: DashboardProject;
  /** The names the copy must not repeat where it is stored. */
  existingNames: readonly string[];
}) {
  const fromTemplate = useBoardFromTemplate({ atOrganization, storeProject });
  const favourites = useFavourites();
  const [asking, setAsking] = useState<CuratedEdit | undefined>();
  // A grid keeps a dragged card where it was dropped; a new key puts it back after Cancel.
  const [gridKey, setGridKey] = useState(0);

  const request = (edit: CuratedEdit) => {
    if (changesCurated({ board, edit })) setAsking(edit);
  };

  const cancel = () => {
    if (asking?.kind === "move") setGridKey((key) => key + 1);
    setAsking(void 0);
  };

  const confirm = async () => {
    if (!asking || fromTemplate.creatingId !== void 0) return;
    const created = await fromTemplate.modifyCurated({
      board: curatedCopySource({ board, edit: asking }),
      existingNames,
      landing: landingFor({ board, edit: asking }),
    });
    cancel();
    // The org-level copy lives in the store project, whose stars are not the ones in view.
    if (!created || atOrganization) return;
    await favourites.replaceStar({
      from: { kind: "template", templateId: board.templateId },
      to: { kind: "board", dashboardId: created.id },
    });
  };

  return {
    isAsking: asking !== void 0,
    isModifying: fromTemplate.creatingId !== void 0,
    gridKey,
    request,
    cancel,
    confirm,
  };
}
