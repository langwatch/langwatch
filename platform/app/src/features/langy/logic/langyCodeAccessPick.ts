/**
 * Which way the developer chose to reach their code, for one card (ADR-129).
 *
 * The card asks until the developer answers, and the answer has to survive a
 * reload: picking "Share my local folder" turns the card into the command and
 * the countdown, and a refresh while the terminal is still being opened must
 * show the same card rather than the question again.
 *
 * The pick belongs to this browser, not to the conversation — the server
 * already holds the control request the pick opened — so it lives in
 * localStorage, keyed by the conversation and the `code_access` call. Every
 * access is guarded: a private window, a browser with site data blocked, and
 * the thumbnail renderer all throw on the accessor itself.
 */

const KEY_PREFIX = "langy:code-access-pick";

function key({
  conversationId,
  callId,
}: {
  conversationId: string;
  callId: string;
}): string {
  return `${KEY_PREFIX}:${conversationId}:${callId}`;
}

/** Did the developer already choose the local folder on this card? */
export function readLocalFolderPick(args: {
  conversationId: string;
  callId: string;
}): boolean {
  try {
    return globalThis.localStorage?.getItem(key(args)) === "local";
  } catch {
    return false;
  }
}

/** Remember that the local folder was chosen on this card. */
export function writeLocalFolderPick(args: {
  conversationId: string;
  callId: string;
}): void {
  try {
    globalThis.localStorage?.setItem(key(args), "local");
  } catch {
    // A browser that refuses to store this still shows the waiting state for
    // as long as the card is mounted, which is the whole of the common case.
  }
}
