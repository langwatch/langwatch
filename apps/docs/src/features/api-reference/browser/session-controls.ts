import { frameConnection, mountFrame, onConnectionChange } from "./docs-session.ts";

/** Hides the pasted key while the frame sends as the reader, and shows it again after. */
export function showSession() {
  const manual = document.querySelector<HTMLElement>("[data-docs-manual-key]");
  if (manual) manual.hidden = frameConnection() !== null;
}

/** Embeds the app's session frame where the page left room for it; none on other endpoints. */
export function startSession() {
  const container = document.querySelector<HTMLElement>("[data-docs-session-frame]");
  if (!container) return;
  mountFrame({ container });
  showSession();
}

onConnectionChange(() => showSession());
