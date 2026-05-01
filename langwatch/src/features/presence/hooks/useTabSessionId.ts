import { useRef } from "react";

/**
 * Stable per-tab sessionId. Persists for the lifetime of the window object,
 * so reloading the tab generates a new id and the prior session's TTL
 * expires server-side. Shared across every presence hook on the page so
 * that all signals (location, cursor, future channels) emit under the same
 * sessionId.
 */
export function useTabSessionId(): string {
  const ref = useRef<string>("");
  if (typeof window === "undefined") return ref.current;
  if (!ref.current) {
    const cached = (window as { __lw_presence_session_id?: string })
      .__lw_presence_session_id;
    if (cached) {
      ref.current = cached;
    } else {
      ref.current = crypto.randomUUID();
      (window as { __lw_presence_session_id?: string }).__lw_presence_session_id =
        ref.current;
    }
  }
  return ref.current;
}
