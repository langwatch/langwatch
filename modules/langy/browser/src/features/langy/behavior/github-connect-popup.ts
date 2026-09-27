import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 760;

const incomingMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("github-connected"), login: z.string() }),
  z.object({ type: z.literal("github-error"), message: z.string() }),
]);

export type ConnectFailureReason = "popup-blocked" | "cancelled" | "failed";

export type ConnectResult =
  | { ok: true; login: string }
  | { ok: false; error: string; reason: ConnectFailureReason };

function popupFeatures(): string {
  const left = Math.max(0, (window.outerWidth - POPUP_WIDTH) / 2 + window.screenX);
  const top = Math.max(0, (window.outerHeight - POPUP_HEIGHT) / 2 + window.screenY);

  return [
    `width=${POPUP_WIDTH}`,
    `height=${POPUP_HEIGHT}`,
    `left=${left}`,
    `top=${top}`,
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
}

function tryReadConnectResult(data: unknown): ConnectResult | null {
  const parsed = incomingMessageSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.type === "github-connected") {
    return { ok: true, login: parsed.data.login };
  }

  return {
    ok: false,
    reason: "failed",
    error: parsed.data.message,
  };
}

const SUPERSEDED: ConnectResult = {
  ok: false,
  reason: "failed",
  error: "Superseded by a new connect attempt",
};
const POPUP_BLOCKED: ConnectResult = {
  ok: false,
  reason: "popup-blocked",
  error: "Popup blocked. Allow popups and try again.",
};
const CANCELLED: ConnectResult = { ok: false, reason: "cancelled", error: "Cancelled" };

/**
 * One GitHub App installation window at a time. The window reports back by `postMessage` from our
 * own origin; closing it without finishing reads as cancelled, and a second connect while it is
 * open focuses it and supersedes the first caller.
 */
class GitHubConnectWindow {
  private popup: Window | null = null;
  private resolver: ((result: ConnectResult) => void) | undefined;
  private poll: number | undefined;

  attach(): void {
    window.addEventListener("message", this.onMessage);
  }

  connect(organizationId: string): Promise<ConnectResult> {
    return new Promise((resolve) => {
      if (this.popup && !this.popup.closed) {
        this.popup.focus();
        this.resolver?.(SUPERSEDED);
        this.resolver = resolve;
        return;
      }
      const organization = encodeURIComponent(organizationId);
      const url = `/api/github/install?mode=popup&organizationId=${organization}`;
      const popup = window.open(url, "github-install", popupFeatures());
      if (!popup) {
        resolve(POPUP_BLOCKED);
        return;
      }
      this.popup = popup;
      this.resolver = resolve;
      this.poll = window.setInterval(this.watchClosed, 500);
    });
  }

  dispose(): void {
    window.removeEventListener("message", this.onMessage);
    this.settle();
  }

  private readonly onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const result = tryReadConnectResult(event.data);
    if (!result) return;
    this.resolver?.(result);
    this.settle();
  };

  private readonly watchClosed = () => {
    if (!this.popup?.closed) return;
    this.resolver?.(CANCELLED);
    this.settle();
  };

  private settle(): void {
    window.clearInterval(this.poll);
    this.poll = undefined;
    this.resolver = undefined;
    this.popup = null;
  }
}

/** Opens the GitHub App installation without discarding the current page. */
export function useGitHubConnectPopup() {
  const [connectWindow] = useState(() => new GitHubConnectWindow());
  useEffect(() => {
    connectWindow.attach();
    return () => connectWindow.dispose();
  }, [connectWindow]);
  const connect = useCallback(
    (organizationId: string) => connectWindow.connect(organizationId),
    [connectWindow],
  );
  return { connect };
}
