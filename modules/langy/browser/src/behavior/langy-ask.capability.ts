import type { LangyAsk } from "@langwatch/langy-contract";

import { useLangyStore } from "./langy.store.ts";

/** What another module may ask through Langy, lent by token; the store stays Langy's. */
export const langyAsk: LangyAsk = {
  ask: ({ question, draft, context = [] }) => {
    const langy = useLangyStore.getState();
    const prompt = question?.trim() ?? "";

    if (prompt) {
      langy.askLangy(prompt);
    } else {
      langy.openPanel();
      // Never over the top of something the reader already started writing.
      if (draft && !useLangyStore.getState().draft.trim()) {
        useLangyStore.getState().setDraft(draft);
      }
    }

    // After the ask: `askLangy` resets conversation-scoped state, so the
    // attachment belongs to the conversation being started, not the last one.
    for (const item of context) {
      useLangyStore.getState().attachContext({ type: item.kind, id: item.ref, label: item.label });
    }
  },
};

export default langyAsk;
