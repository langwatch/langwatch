import type { OrganizationDownload } from "../model/organization-host.ts";

/**
 * Hands the reader a file. The one DOM sequence no capability carries —
 * object URL, anchor, click, revoke — done here rather than by a screen.
 */
export function downloadInBrowser(file: OrganizationDownload): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([file.contents], { type: file.mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
