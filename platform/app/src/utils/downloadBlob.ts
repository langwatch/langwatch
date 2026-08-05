/**
 * Saving a fetched response to disk, browser-side.
 *
 * Every export in the app ends the same two ways: read the name the server
 * chose out of `Content-Disposition`, then hand the body to the browser as a
 * download. Both live here so a hook that streams a file only has to say what
 * it downloaded, not how downloading works.
 */

/** Hands a Blob to the browser as a file download under the given name. */
export function triggerBlobDownload({
  blob,
  filename,
}: {
  blob: Blob;
  filename: string;
}): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * The filename a response named in its `Content-Disposition`, or the fallback
 * when it named none.
 *
 * Reads both the plain `filename=` and the RFC 5987 `filename*=UTF-8''` form,
 * quoted or bare, and percent-decodes what it finds. The fallback matters: a
 * response with no header at all would otherwise land on disk as "download".
 */
export function filenameFromContentDisposition({
  contentDisposition,
  fallbackName,
}: {
  contentDisposition: string | null;
  fallbackName: string;
}): string {
  if (!contentDisposition) return fallbackName;

  const match = contentDisposition.match(
    /filename\*?=(?:UTF-8''|")?([^";]+)"?/i,
  );
  return match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
}
