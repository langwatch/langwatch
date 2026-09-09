/**
 * Which way the developer chose to reach their code, for one card (ADR-129). Belongs to this
 * browser, not the conversation, so it lives in localStorage keyed by conversation + call id and
 * must survive a reload. Every access is guarded, since some contexts throw on the accessor itself.
 */

const KEY_PREFIX = "langy:code-access-pick";

function key({ conversationId, callId }: { conversationId: string; callId: string }): string {
  return `${KEY_PREFIX}:${conversationId}:${callId}`;
}

/** Did the developer already choose the local folder on this card? */
export function readLocalFolderPick(args: { conversationId: string; callId: string }): boolean {
  try {
    return globalThis.localStorage?.getItem(key(args)) === "local";
  } catch {
    return false;
  }
}

/** Remember that the local folder was chosen on this card. */
export function writeLocalFolderPick(args: { conversationId: string; callId: string }): void {
  try {
    globalThis.localStorage?.setItem(key(args), "local");
  } catch {
    // A browser that refuses to store this still shows the waiting state for
    // as long as the card is mounted, which is the whole of the common case.
  }
}
