/**
 * "Duplicate to edit" on a From LangWatch board, from its page or its sidebar row: makes the
 * member's own "<name> (copy)", opens it and drafts the template's report in Langy, unsent,
 * as adding a template does.
 */

import { useLangyAsk } from "../langy/behavior/use-board-langy.ts";
import { boardPromptDraft, boardSubject } from "../langy/model/board-langy.ts";
import type { CuratedBoard } from "../model/curated-boards.ts";
import { useBoardFromTemplate } from "./use-board-from-template.ts";
import { useBoardPeriod } from "./use-board-period.ts";
import { useSavedDashboards } from "./use-saved-dashboards.ts";

export function useDuplicateCurated() {
  const saved = useSavedDashboards();
  const fromTemplate = useBoardFromTemplate();
  const langy = useLangyAsk();
  const { period } = useBoardPeriod();

  const duplicate = async (board: CuratedBoard) => {
    const created = await fromTemplate.duplicateCurated({
      board,
      existingNames: saved.boards.map(({ name }) => name),
    });
    if (!created || !langy.enabled) return;
    const copy = boardSubject({ board: created, widgets: created.widgets });
    langy.ask(boardPromptDraft({ prompt: board.reportPrompt, board: copy, period }));
  };

  return { creatingId: fromTemplate.creatingId, duplicate };
}
