/**
 * The one DOM ability neither port's capabilities carry: writing to the
 * clipboard. Mirrors `@langwatch/browser-host`'s own `CopyButton`, which
 * touches `navigator.clipboard` the same way rather than through a port.
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
