/**
 * Writing to the reader's clipboard.
 *
 * One line of browser API, in the global layer for the reason every other
 * module here is: a frontend feature may not name a browser global, because a
 * feature that reaches `navigator` directly cannot be mounted anywhere else and
 * cannot be driven by a test that has no browser. `ui-browser-storage.ts` makes
 * the same cut for Web Storage.
 *
 * REJECTS RATHER THAN ANSWERING FALSE, and that is deliberate: a clipboard write
 * is refused in a non-secure context and in some private-browsing modes, and the
 * refusal arrives as a rejection carrying a reason. Swallowing it here would
 * leave every caller with a bare boolean and nothing to log.
 */
export function writeUiClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
