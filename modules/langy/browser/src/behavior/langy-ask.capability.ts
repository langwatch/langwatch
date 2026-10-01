import { useLangyStore, type LangyAttachedContextType } from "@langwatch/langy-browser-kit";

/** One reference the asking module hands over with its question. */
export interface LangyAskContext {
  kind: LangyAttachedContextType;
  /** The ref the agent scopes the answer to; it is the chip's id too. */
  ref: string;
  label: string;
}

/** A question to ask outright, or a sentence for the reader to finish. */
export interface LangyAskRequest {
  question?: string;
  draft?: string;
  context?: readonly LangyAskContext[];
}

/**
 * What another module may ask through Langy, and nothing more. A consumer takes
 * this through its own `*HostApi`, which the shell wires from here; Langy's
 * store stays private to Langy.
 */
export interface LangyAskCapability {
  ask: (request: LangyAskRequest) => void;
}

export const langyAsk: LangyAskCapability = {
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
