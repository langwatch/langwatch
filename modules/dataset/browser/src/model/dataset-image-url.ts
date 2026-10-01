/** Decide if cell value is an image and fetch URL. Pure function for model layer. */

/** Image hosts that serve pictures without a file extension. */
function isGoogleImageHost(host: string): boolean {
  return (
    host === "gstatic.com" ||
    host.endsWith(".gstatic.com") ||
    host === "googleusercontent.com" ||
    host.endsWith(".googleusercontent.com")
  );
}

/** A long opaque last segment is usually encoded image data. */
function hasOpaqueImageSegment(pathname: string): boolean {
  if (pathname.length <= 30) return false;
  if (/image|img|photo|pic|picture|media|content|upload/i.test(pathname)) return true;

  const lastSegment = pathname.split("/").at(-1);

  return Boolean(lastSegment && lastSegment.length > 50 && /^[A-Za-z0-9+/=]+$/.test(lastSegment));
}

function looksLikeImageUrl({ text, url }: { text: string; url: URL }): boolean {
  if (/\.(jpeg|jpg|gif|png|webp|svg|bmp)(\?.*)?$/i.test(text)) return true;
  if (isGoogleImageHost(url.hostname)) return true;

  return hasOpaqueImageSegment(url.pathname);
}

/** The image URL a cell value names, or `null` when it names none. */
export const datasetImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;

  const text = value.trim();

  // Markdown image syntax: ![alt](url)
  const markdownMatch = /^!\[.*?\]\((.*?)\)$/.exec(text);
  if (markdownMatch?.[1]) return markdownMatch[1];

  if (text.startsWith("data:image/")) {
    return /^data:image\/(jpeg|jpg|gif|png|webp|svg\+xml|bmp);base64,/i.test(text) ? text : null;
  }

  try {
    return looksLikeImageUrl({ text, url: new URL(text) }) ? text : null;
  } catch {
    return null;
  }
};

/**
 * The URL to actually request. A remote image goes through the app's
 * proxy so a third-party host never sees the reader's referrer, and a
 * mixed-content or CORS-hostile host still renders. Others are already fetchable.
 */
export const proxiedDatasetImageUrl = (url: string): string => {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("/")) return url;
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
};
