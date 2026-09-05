import { useCallback } from "react";
import { useCanAskLangy } from "../../../../behavior/langy/use-can-ask-langy";
import { useShowLangy } from "../../langy/hooks/use-show-langy";
import { useLangyStore } from "@langwatch/langy-web";
import { useFilterStore } from "../../../../index";
import { handOffSearchToLangy } from "./search-langy-handoff";

/**
 * Does Langy own the search bar's ask affordance — and the handoff when it does.
 */
export function useAskLangyFromSearch(): {
  /** Langy owns the ask affordance for this user; false keeps inline Ask AI. */
  langyRoutesAsk: boolean;
  /** Hand off to Langy: ask `typedText` if given, with the search attached. */
  askLangyFromSearch: (typedText?: string) => void;
} {
  const showLangy = useShowLangy();
  const canAskLangy = useCanAskLangy();
  const askLangy = useLangyStore((s) => s.askLangy);
  const openPanel = useLangyStore((s) => s.openPanel);
  const attachContext = useLangyStore((s) => s.attachContext);

  const askLangyFromSearch = useCallback(
    (typedText?: string) => {
      handOffSearchToLangy({
        typedText,
        // Read at call time rather than subscribing — the handoff needs the
        // query once per click, not a re-render per keystroke.
        appliedQueryText: useFilterStore.getState().queryText,
        askLangy,
        openPanel,
        attachContext,
        // Never over the top of something the reader already started writing:
        // they may have opened the panel, begun a question, and come back for
        // the filter. Read at call time for the same reason the query is.
        seedDraft: (text) => {
          if (useLangyStore.getState().draft.trim()) return;
          useLangyStore.getState().setDraft(text);
        },
      });
    },
    [askLangy, openPanel, attachContext],
  );

  return { langyRoutesAsk: showLangy && canAskLangy, askLangyFromSearch };
}
