/**
 * In the global layer since a feature may not name `navigator` directly.
 * REJECTS rather than answering false — a write can be refused (insecure
 * context, private browsing), and the refusal carries a reason to log.
 */
export function writeUiClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
