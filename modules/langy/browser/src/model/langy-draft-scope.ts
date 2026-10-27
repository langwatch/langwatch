/**
 * A draft another module seeds into the composer, kept to what it is about: it waits until
 * that reaches the screen, then goes with its context, unsent and untouched, once the screen
 * moves on. Text the reader typed is never dropped. Pure.
 */

import type { LangyDraftAbout } from "@langwatch/langy-contract";

/**
 * A seeded draft, the context chips that came with it, and whether what it is about has
 * been on screen since it was seeded.
 */
export type SeededDraft = {
  text: string;
  about: LangyDraftAbout;
  contextIds: readonly string[];
  shown: boolean;
};

/** Whether the page shows what a draft is about: the same thing, and the same item in it. */
export function isOnScreen({
  about,
  onScreen,
}: {
  about: LangyDraftAbout;
  onScreen: LangyDraftAbout | null;
}): boolean {
  return onScreen !== null && about.ref === onScreen.ref && about.itemRef === onScreen.itemRef;
}

/** A seed may fill an empty composer, or replace the last seed while it is untouched. */
export function maySeed({
  composer,
  seeded,
}: {
  composer: string;
  seeded: SeededDraft | null;
}): boolean {
  return composer.trim() === "" || (seeded !== null && composer === seeded.text);
}

/** The seed once the screen changes, and whether its untouched text leaves the composer. */
export function followScreen({
  seeded,
  composer,
  onScreen,
}: {
  seeded: SeededDraft | null;
  composer: string;
  onScreen: LangyDraftAbout | null;
}): { seeded: SeededDraft | null; drop: boolean } {
  // Edited or sent: the text is the reader's now, so it stays.
  if (seeded === null || composer !== seeded.text) return { seeded: null, drop: false };
  if (isOnScreen({ about: seeded.about, onScreen })) {
    return { seeded: { ...seeded, shown: true }, drop: false };
  }
  // A new board loads after its draft lands, so a seed not yet shown keeps waiting.
  if (!seeded.shown) return { seeded, drop: false };
  return { seeded: null, drop: true };
}
