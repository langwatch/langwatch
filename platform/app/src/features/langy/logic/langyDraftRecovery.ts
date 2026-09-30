/**
 * What a failed send hands back to the composer.
 *
 * Losing typed text is the worst failure a composer has, so a send that breaks
 * gives the words back. Three things are NOT the reader's words, and putting
 * any of them in the field is its own bug:
 *
 *   - a message the panel sent on their behalf (the code access re-ask): they
 *     never wrote it, and it appeared in the field as if they had;
 *   - a message whose turn already started: it is a bubble in the transcript,
 *     and a failure later in that turn used to duplicate it into the field;
 *   - anything at all, once they have started typing something else.
 *
 * The panel clears its memory of the sent text on both of the first two, so
 * `sentText` is null there; this function is the last rule, and the one place
 * the whole decision is written down.
 */
export function langyDraftToRestore({
  sentText,
  draft,
}: {
  /** The text of the send that failed, or null when it was not the reader's. */
  sentText: string | null;
  /** What is in the composer right now. */
  draft: string;
}): string | null {
  if (!sentText) return null;
  if (draft.trim()) return null;
  return sentText;
}
