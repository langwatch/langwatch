import { frameConnection, mountFrame, onConnectionChange } from "./docs-session.ts";

/** Hides the pasted key while the frame sends as the reader, and shows it again after. */
export function showSession() {
  const manual = document.querySelector<HTMLElement>("[data-docs-manual-key]");
  if (manual) manual.hidden = frameConnection() !== null;
}

/**
 * Embeds the app's session frame, or keeps the one a previous page embedded, over the room this
 * page leaves for it; none on endpoints that leave none.
 */
export function startSession() {
  if (!document.querySelector("[data-docs-session-frame]")) return;
  mountFrame();
  showSession();
}

onConnectionChange(() => showSession());
