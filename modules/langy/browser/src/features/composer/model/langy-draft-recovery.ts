/**
 * What a failed send hands back to the composer — never a message sent on the reader's behalf,
 * one whose turn already started, or anything once they've started typing something else.
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
