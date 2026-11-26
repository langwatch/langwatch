import type { LangyAsk } from "@langwatch/langy-client";
import type { LangyAskRequest, LangyDraftAbout } from "@langwatch/langy-contract";

import { followScreen, isOnScreen, maySeed, type SeededDraft } from "../model/langy-draft-scope.ts";
import { useLangyPageContextStore } from "./langy-page-context.store.ts";
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
  const contextIds = context.map(({ ref, key }) => key ?? ref);
  return { text: draft, about, contextIds, shown: isOnScreen({ about, onScreen: screen }) };
}

/**
 * Attaches one piece of an ask's context. A chip the page offers (its id as the key, or the same
 * kind and ref) is chosen, and returned when the reader had not chosen it; the rest is attached
 * under its key, so asking about the same board or widget again replaces its entry.
 */
function attachAskContext(item: NonNullable<LangyAskRequest["context"]>[number]): string[] {
  const langy = useLangyStore.getState();
  const onPage = useLangyPageContextStore
    .getState()
    .pageContext.find(
      (chip) => chip.id === item.key || (chip.kind === item.kind && chip.ref === item.ref),
    );
  if (onPage) {
    if (item.key !== void 0) langy.detachContext(item.key);
    const wasChosen = langy.chosenChipIds.has(onPage.id);
    langy.chooseChip(onPage.id);
    return wasChosen ? [] : [onPage.id];
  }
  langy.attachContext({
    type: item.kind,
    id: item.ref,
    label: item.label,
    ...(item.key === void 0 ? {} : { key: item.key }),
  });
  return [];
}

/** Takes off the chips a dropped seed chose, leaving the rest as the reader set them. */
function unchooseChips(ids: readonly string[]): void {
  if (ids.length === 0) return;
  useLangyStore.setState((state) => {
    const chosen = new Set(state.chosenChipIds);
    for (const id of ids) chosen.delete(id);
    return { chosenChipIds: chosen };
  });
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

      const before = seeded;
      if (prompt) {
        langy.askLangy(prompt, request.askedFrom);
      } else {
        langy.openPanel();
        // Opened from another page to be written in: the cursor waits in the composer.
        langy.requestComposerFocus();
        seeded = seedDraft({ request, seeded, screen });
      }

      // After the ask: `askLangy` resets conversation-scoped state, so the
      // attachment belongs to the conversation being started, not the last one.
      const chipIds = (request.context ?? []).flatMap((item) => attachAskContext(item));
      // A seed that replaced an untouched one takes over the chips that one chose.
      if (seeded !== null && seeded !== before) {
        seeded = { ...seeded, chipIds: [...(before?.chipIds ?? []), ...chipIds] };
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
      unchooseChips(dropped.chipIds ?? []);
    },
  };
}

export const langyAsk: LangyAsk = createLangyAsk();

export default langyAsk;
