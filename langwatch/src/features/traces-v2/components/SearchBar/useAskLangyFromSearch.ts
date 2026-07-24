import { useCallback } from "react";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useShowLangy } from "~/features/langy/hooks/useShowLangy";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useFilterStore } from "../../stores/filterStore";
import { handOffSearchToLangy } from "./searchLangyHandoff";

/**
 * Does Langy own the search bar's ask affordance — and the handoff when it does.
 *
 * Both gates, on purpose: `useShowLangy` (rollout + membership + `langy:view`)
 * is what mounts the panel at all, and `useCanAskLangy` (`langy:create`) is
 * what lets a queued question actually send. Offering the handoff on either
 * alone would be a door into a panel that doesn't render, or a composer whose
 * every send 403s. When either says no, the search bar keeps the inline Ask AI
 * composer instead — the affordance downgrades, it never goes dead.
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
