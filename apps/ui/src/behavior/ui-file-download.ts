/**
 * Handing the reader a file the browser never fetched — a screen may not
 * mint an object URL or click an anchor, so this lives in a host port.
 * ORDER IS LOAD-BEARING: click before revoke, or Chrome cancels the save.
 */
export function downloadUiFile({
  fileName,
  contents,
  mediaType,
}: {
  fileName: string;
  contents: string;
  mediaType: string;
}): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mediaType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.setAttribute("download", fileName);
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
