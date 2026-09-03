/**
 * Whether a cell value is an image, and where the browser should fetch it.
 *
 * A family-local copy of `getImageUrl` / `getProxiedImageUrl` from
 * `platform/app/src/components/ExternalImage`, which the trace media strip, the
 * batch-evaluation results and the studio results panel still import.
 * Deletes-only forbids repointing them, so the platform copy stays for those
 * consumers and this one travels with the dataset editor.
 *
 * Pure — it decides a string, so it lives in `model` and the element that
 * renders the picture imports it rather than owning it.
 */

/** The image URL a cell value names, or `null` when it names none. */
export const datasetImageUrl = (value: unknown): string | null => {
  if (!value) return null;

  const text = String(value).trim();

  // Markdown image syntax: ![alt](url)
  const markdownMatch = /^!\[.*?\]\((.*?)\)$/.exec(text);
  if (markdownMatch?.[1]) return markdownMatch[1];

  if (text.startsWith("data:image/")) {
    return /^data:image\/(jpeg|jpg|gif|png|webp|svg\+xml|bmp);base64,/i.test(text) ? text : null;
  }

  try {
    const url = new URL(text);

    if (/\.(jpeg|jpg|gif|png|webp|svg|bmp)(\?.*)?$/i.test(text)) return text;

    // Image hosts that serve pictures without a file extension.
    const host = url.hostname;
    const isGoogleImageHost =
      host === "gstatic.com" ||
      host.endsWith(".gstatic.com") ||
      host === "googleusercontent.com" ||
      host.endsWith(".googleusercontent.com");
    if (isGoogleImageHost) return text;

    const { pathname } = url;
    if (pathname && pathname.length > 30) {
      if (/image|img|photo|pic|picture|media|content|upload/i.test(pathname)) return text;

      // A long opaque last segment is usually encoded image data.
      const lastSegment = pathname.split("/").at(-1);
      if (lastSegment && lastSegment.length > 50 && /^[A-Za-z0-9+/=]+$/.test(lastSegment)) {
        return text;
      }
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * The URL to actually request.
 *
 * A remote image goes through the application's proxy so a third-party host
 * never sees the reader's referrer, and so a mixed-content or CORS-hostile host
 * still renders. Data URLs and same-origin paths are already fetchable.
 */
export const proxiedDatasetImageUrl = (url: string): string => {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("/")) return url;
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
};
