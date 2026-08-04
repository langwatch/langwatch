/**
 * Open the LangWatch GitHub App installation in a popup window and resolve with
 * the installed account once the setup shim posts back.
 *
 * Why a popup (not a redirect): the user is mid-conversation with Langy. A
 * full-page redirect drops the chat state on the floor. The popup runs the
 * install in a separate window and `postMessage`s the result back so the
 * sidebar can pick the conversation up exactly where it left off.
 *
 * Spec: specs/langy/langy-github-install.feature. Issue: #4747.
 */
import { useCallback, useEffect, useRef } from "react";

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 760;
const POPUP_FEATURES = (() => {
  if (typeof window === "undefined") return "";
  const left = Math.max(
    0,
    (window.outerWidth - POPUP_WIDTH) / 2 + window.screenX,
  );
  const top = Math.max(
    0,
    (window.outerHeight - POPUP_HEIGHT) / 2 + window.screenY,
  );
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
})();

/**
 * Why a connect attempt didn't complete. The card reads this to decide how to
 * respond: a soft `cancelled` is silent, a `popup-blocked` offers the full-page
 * route into the same integration flow, and `failed` shows the message.
 */
export type ConnectFailureReason = "popup-blocked" | "cancelled" | "failed";

export type ConnectResult =
  | { ok: true; login: string }
  | { ok: false; error: string; reason: ConnectFailureReason };

type IncomingMessage =
  | { type: "langy-github-connected"; login: string }
  | { type: "langy-github-error"; message: string };

export function useGitHubConnectPopup() {
  const popupRef = useRef<Window | null>(null);
  const resolverRef = useRef<((r: ConnectResult) => void) | null>(null);
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
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as IncomingMessage | undefined;
      if (!data || typeof data !== "object") return;
      if (
        data.type === "langy-github-connected" &&
        typeof data.login === "string"
      ) {
        resolverRef.current?.({ ok: true, login: data.login });
        cleanup();
      } else if (data.type === "langy-github-error") {
        resolverRef.current?.({
          ok: false,
          reason: "failed",
          error:
            typeof data.message === "string"
              ? data.message
              : "connection failed",
        });
        cleanup();
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      cleanup();
    };
  }, [cleanup]);

  const connect = useCallback(
    (organizationId: string): Promise<ConnectResult> => {
      return new Promise((resolve) => {
        // If a previous popup is still open from this hook, point at it again
        // rather than spawning a second one. Settle the prior caller's promise
        // first — overwriting resolverRef without calling it would hang the
        // first connect() promise forever.
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
        // The one canonical GitHub integration entry point — the SAME endpoint
        // Settings → Integrations opens (that page uses `mode=redirect`; here we
        // use `mode=popup` so the chat state survives). There is no separate
        // "connect" flow to invent: an App installation IS the access boundary.
        const url = `/api/github-langy/install?mode=popup&organizationId=${encodeURIComponent(organizationId)}`;
        const win = window.open(url, "langy-github-install", POPUP_FEATURES);
        if (!win) {
          resolve({
            ok: false,
            reason: "popup-blocked",
            error: "Popup blocked. Allow popups and try again.",
          });
          return;
        }
        popupRef.current = win;
        resolverRef.current = resolve;
        // If the user closes the popup without completing, we'd otherwise hang
        // forever. Poll for closed-without-message and treat it as a soft cancel.
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
      });
    },
    [cleanup],
  );

  return { connect };
}
