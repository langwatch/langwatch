/**
 * Handing the reader a file the browser never fetched.
 *
 * The other half of a report a package decided the contents of. A screen may
 * not mint an object URL, synthesise an anchor or click one — four browser
 * globals and a DOM mutation, none of which a feature package can be mounted
 * outside a browser with — so the ABILITY travels through a host port and the
 * sequence lives here, where it can be driven by a test.
 *
 * THE ORDER IS LOAD-BEARING and it is the reason this is a named function
 * rather than four inline lines. The anchor has to be IN the document before it
 * is clicked (a detached anchor's click does nothing in Chrome), and the object
 * URL has to be revoked AFTER the click and not before, or the save is
 * cancelled by the revoke it was racing. Revoking not at all leaks the blob for
 * the life of the document, which on a page whose whole purpose is repeated
 * exports is not a rounding error.
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
