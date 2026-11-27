/**
 * Adding a template makes the member's own new board from it, opens it and drafts the template's
 * report in Langy, unsent (AC140): from the templates finder and a From LangWatch board's "Use
 * this template" alike. An empty board's templates fill that board instead (use-apply-template).
 */

import type { DashboardProject } from "@langwatch/dashboard-contract";

import { useLangyAsk } from "../langy/behavior/use-board-langy.ts";
import { boardPromptDraft, boardSubject } from "../langy/model/board-langy.ts";
import type { BoardTemplate } from "../templates/index.ts";
import { useBoardFromTemplate } from "./use-board-from-template.ts";
import { useBoardPeriod } from "./use-board-period.ts";

export function useAddTemplate({
  atOrganization = false,
  storeProject,
  existingNames,
}: {
  atOrganization?: boolean;
  storeProject?: DashboardProject;
  /** The names a new board must not repeat where it is stored. */
  existingNames: readonly string[];
}) {
  const fromTemplate = useBoardFromTemplate({ atOrganization, storeProject });
  const langy = useLangyAsk();
  // No template address carries a period, so this is the one a new board opens on.
  const { period } = useBoardPeriod();

  const add = async (template: BoardTemplate) => {
    const created = await fromTemplate.createFromTemplate({ template, existingNames });
    if (!created || !langy.enabled || !template.reportPrompt) return;
    const board = boardSubject({ board: created, widgets: created.widgets });
    langy.ask(boardPromptDraft({ prompt: template.reportPrompt, board, period }));
  };

  return { creatingId: fromTemplate.creatingId, add };
}
