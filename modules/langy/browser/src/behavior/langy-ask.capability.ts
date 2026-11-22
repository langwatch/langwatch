import type { LangyAsk } from "@langwatch/langy-client";
import type { LangyAskRequest, LangyDraftAbout } from "@langwatch/langy-contract";

import { followScreen, isOnScreen, maySeed, type SeededDraft } from "../model/langy-draft-scope.ts";
import { useLangyStore } from "./langy.store.ts";

type Seed = Pick<LangyAskRequest, "draft" | "about" | "context">;

/** Puts a draft in the composer unless the reader started writing; returns the seed kept. */
function seedDraft({
  request: { draft, about, context = [] },
  seeded,
  screen,
}: {
  request: Seed;
  seeded: SeededDraft | null;
  screen: LangyDraftAbout | null;
}): SeededDraft | null {
  const composer = useLangyStore.getState().draft;
  if (!draft || !maySeed({ composer, seeded })) return seeded;
  useLangyStore.getState().setDraft(draft);
  if (!about) return null;
  const contextIds = context.map(({ ref }) => ref);
  return { text: draft, about, contextIds, shown: isOnScreen({ about, onScreen: screen }) };
}

/**
 * What another module may ask through Langy, lent by token; the store stays Langy's. Each
 * instance keeps the seed it planted and what the page shows, to scope that seed.
 */
export function createLangyAsk(): LangyAsk {
  let seeded: SeededDraft | null = null;
  let screen: LangyDraftAbout | null = null;

  return {
    ask: (request) => {
      const langy = useLangyStore.getState();
      const prompt = request.question?.trim() ?? "";

      if (prompt) {
        langy.askLangy(prompt);
      } else {
        langy.openPanel();
        // Opened from another page to be written in: the cursor waits in the composer.
        langy.requestComposerFocus();
        seeded = seedDraft({ request, seeded, screen });
      }

      // After the ask: `askLangy` resets conversation-scoped state, so the
      // attachment belongs to the conversation being started, not the last one.
      for (const item of request.context ?? []) {
        useLangyStore
          .getState()
          .attachContext({ type: item.kind, id: item.ref, label: item.label });
      }
    },
    onScreen: (about) => {
      screen = about;
      const followed = followScreen({
        seeded,
        composer: useLangyStore.getState().draft,
        onScreen: about,
      });
      const dropped = seeded;
      seeded = followed.seeded;
      if (!followed.drop || !dropped) return;
      const langy = useLangyStore.getState();
      langy.setDraft("");
      for (const id of dropped.contextIds) langy.detachContext(id);
    },
  };
}

export const langyAsk: LangyAsk = createLangyAsk();

export default langyAsk;
