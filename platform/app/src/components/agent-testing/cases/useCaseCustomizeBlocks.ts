/**
 * The optional blocks of the scenario dialog: the parameters, the turn
 * limits, the model overrides and the caller voice.
 *
 * The dialog asks its four questions and offers the rest as chips, the way the
 * run dialog does. A chip opens its block; the x on the block closes it again
 * and clears what it held. A stored scenario opens the blocks it already uses, so
 * nothing a scenario carries is hidden from the person editing it.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useEffect, useState } from "react";
import { useVoiceAgentsEnabled } from "~/components/agents/voice/useVoiceAgentsEnabled";
import type { CustomizeChip } from "../shared/CustomizeChips";
import type { CaseDraft } from "./useCaseEditor";

/** Which of the optional blocks are open. */
type OpenBlocks = {
  parameters: boolean;
  turns: boolean;
  models: boolean;
  callerVoice: boolean;
};

const NONE_OPEN: OpenBlocks = {
  parameters: false,
  turns: false,
  models: false,
  callerVoice: false,
};

/** The blocks a draft already needs, so editing a scenario opens them. */
function blocksOf(draft: CaseDraft): OpenBlocks {
  return {
    parameters: draft.parameters.trim() !== "",
    turns: draft.maxTurns !== null || draft.minTurns !== null,
    models: draft.simulatorModel !== null || draft.judgeModel !== null,
    callerVoice: draft.callerVoice !== null,
  };
}

export type CaseCustomizeBlocks = {
  showParameters: boolean;
  showTurns: boolean;
  showModels: boolean;
  showCallerVoice: boolean;
  removeParameters: () => void;
  removeTurns: () => void;
  removeModels: () => void;
  removeCallerVoice: () => void;
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
  const voiceAgentsEnabled = useVoiceAgentsEnabled();

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

  const removeCallerVoice = useCallback(() => {
    setOpen((current) => ({ ...current, callerVoice: false }));
    setDraft({ callerVoice: null });
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
  if (!open.callerVoice && voiceAgentsEnabled) {
    chips.push({
      key: "case-caller-voice",
      label: "Caller voice",
      onAdd: () => setOpen((current) => ({ ...current, callerVoice: true })),
    });
  }

  return {
    showParameters: open.parameters,
    showTurns: open.turns,
    showModels: open.models,
    showCallerVoice: open.callerVoice && voiceAgentsEnabled,
    removeParameters,
    removeTurns,
    removeModels,
    removeCallerVoice,
    chips,
  };
}
