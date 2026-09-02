/**
 * The optional blocks of the test case dialog: the parameters, the turn
 * limits and the model overrides.
 *
 * The dialog asks its four questions and offers the rest as chips, the way the
 * run dialog does. A chip opens its block; the x on the block closes it again
 * and clears what it held. A stored case opens the blocks it already uses, so
 * nothing a case carries is hidden from the person editing it.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useEffect, useState } from "react";
import type { CustomizeChip } from "../../../elements/agent-testing/shared/customize-chips";
import type { CaseDraft } from "./use-case-editor";

/** Which of the optional blocks are open. */
type OpenBlocks = {
  parameters: boolean;
  turns: boolean;
  models: boolean;
};

const NONE_OPEN: OpenBlocks = {
  parameters: false,
  turns: false,
  models: false,
};

/** The blocks a draft already needs, so editing a case opens them. */
function blocksOf(draft: CaseDraft): OpenBlocks {
  return {
    parameters: draft.parameters.trim() !== "",
    turns: draft.maxTurns !== null || draft.minTurns !== null,
    models: draft.simulatorModel !== null || draft.judgeModel !== null,
  };
}

export type CaseCustomizeBlocks = {
  showParameters: boolean;
  showTurns: boolean;
  showModels: boolean;
  removeParameters: () => void;
  removeTurns: () => void;
  removeModels: () => void;
  /** The blocks that are not open yet, in the order they are offered. */
  chips: CustomizeChip[];
};

export function useCaseCustomizeBlocks({
  seedCount,
  draft,
  setDraft,
}: {
  /** Rises every time the draft is seeded, which is when the blocks follow it. */
  seedCount: number;
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
}): CaseCustomizeBlocks {
  const [open, setOpen] = useState<OpenBlocks>(NONE_OPEN);

  useEffect(() => {
    setOpen(blocksOf(draft));
    // The blocks follow the draft the dialog was seeded with, not every
    // keystroke after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedCount]);

  const removeParameters = useCallback(() => {
    setOpen((current) => ({ ...current, parameters: false }));
    setDraft({ parameters: "" });
  }, [setDraft]);

  const removeTurns = useCallback(() => {
    setOpen((current) => ({ ...current, turns: false }));
    setDraft({ maxTurns: null, minTurns: null });
  }, [setDraft]);

  const removeModels = useCallback(() => {
    setOpen((current) => ({ ...current, models: false }));
    setDraft({ simulatorModel: null, judgeModel: null });
  }, [setDraft]);

  const chips: CustomizeChip[] = [];
  if (!open.parameters) {
    chips.push({
      key: "case-parameters",
      label: "Add parameters",
      onAdd: () => setOpen((current) => ({ ...current, parameters: true })),
    });
  }
  if (!open.turns) {
    chips.push({
      key: "case-turns",
      label: "Define min and max turns",
      onAdd: () => setOpen((current) => ({ ...current, turns: true })),
    });
  }
  if (!open.models) {
    chips.push({
      key: "case-models",
      label: "Override models",
      onAdd: () => setOpen((current) => ({ ...current, models: true })),
    });
  }

  return {
    showParameters: open.parameters,
    showTurns: open.turns,
    showModels: open.models,
    removeParameters,
    removeTurns,
    removeModels,
    chips,
  };
}
