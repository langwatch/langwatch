import { useFilterStore, useTraceViewContext } from "@langwatch/trace-browser-kit";
import { useCallback } from "react";

import { useCanAskLangy } from "../../../../behavior/langy/use-can-ask-langy.ts";
import { useOptionalTraceHost } from "../../../../behavior/trace-host.ts";
import { useShowLangy } from "../../langy/hooks/use-show-langy.ts";
import { handOffSearchToLangy } from "./search-langy-handoff.ts";

/**
 * Does Langy own the search bar's ask affordance — and the handoff when it does.
 * Both gates: the one that mounts the panel, and the one that lets a queued
 * question send. When either says no, the inline Ask AI composer stays.
 */
export function useAskLangyFromSearch(): {
  /** Langy owns the ask affordance for this user; false keeps inline Ask AI. */
  langyRoutesAsk: boolean;
  /** Hand off to Langy: ask `typedText` if given, with the search attached. */
  askLangyFromSearch: (typedText?: string) => void;
} {
  const showLangy = useShowLangy();
  const canAskLangy = useCanAskLangy();
  const host = useOptionalTraceHost();
  // The view the passive page context would send: time range, lens, sort,
  // grouping, applied search. The explicit route sends at least as much.
  const viewContext = useTraceViewContext();

  const askLangyFromSearch = useCallback(
    (typedText?: string) => {
      host?.askLangy(
        handOffSearchToLangy({
          typedText,
          // Read at call time rather than subscribing — the handoff needs the
          // query once per click, not a re-render per keystroke.
          appliedQueryText: useFilterStore.getState().queryText,
          viewContext,
        }),
      );
    },
    [host, viewContext],
  );

  return { langyRoutesAsk: showLangy && canAskLangy, askLangyFromSearch };
}
