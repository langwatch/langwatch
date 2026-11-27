/**
 * The one message a conversation's queued messages become when Langy picks them up.
 * Spec: modules/langy/specs/langy-queue-while-busy.feature
 */

/** What a queued message holds; images stay opaque here. */
export interface LangyQueuedParts<Image> {
  text: string;
  images: readonly Image[];
}

/** The queued messages' texts in the order they were sent, one paragraph each, and every image. */
export function langyFollowUpOf<Image>(
  queued: readonly LangyQueuedParts<Image>[],
): LangyQueuedParts<Image> {
  return {
    text: queued
      .map((message) => message.text.trim())
      .filter(Boolean)
      .join("\n\n"),
    images: queued.flatMap((message) => message.images),
  };
}

/** A queued message's text put back into the composer, ahead of anything already typed there. */
export function langyDraftWithQueued({ queued, draft }: { queued: string; draft: string }) {
  return draft.trim() ? `${queued}\n${draft}` : queued;
}
