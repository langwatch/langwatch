import { useCallback, useEffect, useRef } from "react";
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

/** Opens the GitHub App installation without discarding the current page. */
export function useGitHubConnectPopup() {
  const popupRef = useRef<Window | null>(null);
  const resolverRef = useRef<((result: ConnectResult) => void) | null>(null);
  const pollRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    resolverRef.current = null;
    popupRef.current = null;
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) {
        return;
      }

      const result = tryReadConnectResult(event.data);
      if (!result) {
        return;
      }

      resolverRef.current?.(result);
      cleanup();
    }

    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
      cleanup();
    };
  }, [cleanup]);

  const connect = useCallback(
    (organizationId: string): Promise<ConnectResult> =>
      new Promise((resolve) => {
        if (popupRef.current && !popupRef.current.closed) {
          popupRef.current.focus();
          resolverRef.current?.({
            ok: false,
            reason: "failed",
            error: "Superseded by a new connect attempt",
          });
          resolverRef.current = resolve;
          return;
        }

        const organization = encodeURIComponent(organizationId);
        const url = `/api/github/install?mode=popup&organizationId=${organization}`;
        const popup = window.open(url, "github-install", popupFeatures());
        if (!popup) {
          resolve({
            ok: false,
            reason: "popup-blocked",
            error: "Popup blocked. Allow popups and try again.",
          });
          return;
        }

        popupRef.current = popup;
        resolverRef.current = resolve;
        pollRef.current = window.setInterval(() => {
          if (popupRef.current?.closed) {
            resolverRef.current?.({
              ok: false,
              reason: "cancelled",
              error: "Cancelled",
            });
            cleanup();
          }
        }, 500);
      }),
    [cleanup],
  );

  return { connect };
}
