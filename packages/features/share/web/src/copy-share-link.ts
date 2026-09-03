/**
 * `navigator.clipboard` needs a secure context, so a self-hosted plain-http
 * domain has no clipboard at all. Report that rather than failing silently;
 * the caller owns how it tells the reader.
 */
export async function copyShareLink(url: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return false;
    }

    await navigator.clipboard.writeText(url);

    return true;
  } catch {
    return false;
  }
}
