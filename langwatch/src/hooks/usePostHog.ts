import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { usePublicEnv } from "./usePublicEnv";

// Returns a cancel function so callers can drop pending work if the effect
// tears down (or re-runs) before the idle/load callback fires — otherwise a
// stale callback from a previous render/session could call
// startSessionRecording() after the component believes recording was never
// started, silently re-enabling it out from under later state.
function startSessionRecordingWhenIdle(): () => void {
  let cancelled = false;
  const guarded = () => {
    if (!cancelled) posthog.startSessionRecording();
  };

  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(guarded, { timeout: 4000 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback?.(handle);
    };
  }

  // Safari has no requestIdleCallback — fall back to load + timeout.
  if (document.readyState === "complete") {
    const timeoutId = setTimeout(guarded, 0);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }

  const onLoad = () => setTimeout(guarded, 0);
  window.addEventListener("load", onLoad, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", onLoad);
  };
}

export function usePostHog() {
  const publicEnv = usePublicEnv();
  const cancelStartSessionRecordingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!publicEnv.data) return;

    const posthogKey = publicEnv.data?.POSTHOG_KEY;
    const posthogHost = publicEnv.data?.POSTHOG_HOST;

    if (posthogKey) {
      // capture_pageview: "history_change" tells posthog-js to capture
      // $pageview on every History API navigation (pushState / popstate),
      // not just on initial page load. In posthog-js 1.369 this defaults
      // to true (initial load only) unless `defaults` is set to >=
      // '2025-05-24', so we set it explicitly to avoid silently dropping
      // SPA pageviews after the migration off Next.js.
      // We deliberately do NOT also call posthog.capture("$pageview") on
      // routeChangeComplete — letting posthog-js handle it avoids the
      // multiplier bug from the next-router compat layer (every mounted
      // useRouter() instance used to fan out one capture per consumer).
      posthog.init(posthogKey, {
        api_host: posthogHost ?? "https://eu.i.posthog.com",
        person_profiles: "always",
        autocapture: true,
        capture_pageview: "history_change",
        capture_exceptions: true,
        // Recording options stay configured, but recording itself starts
        // disabled — the recorder chunk (rrweb + replay extensions) is
        // 50KB+ and was loading eagerly as part of init, competing with
        // first paint. Core capture (autocapture/pageview/identify) stays
        // eager below; only the recorder's own fetch is deferred to idle
        // via startSessionRecordingWhenIdle(), so no events are dropped.
        session_recording: {
          recordCrossOriginIframes: true,
        },
        disable_session_recording: true,
        loaded: (posthog) => {
          // Explicitly expose `window.posthog` so the PostHog toolbar
          // (launched from the PostHog dashboard's "Toolbar" button)
          // can attach in any environment, not just development. The
          // posthog-js library sets this internally on most builds, but
          // bundlers and strict-mode wrappers can sometimes strip the
          // implicit global; the assignment is best-effort and has no
          // downside in environments where it's already set.
          // SSR-safety guard: unreachable in this Vite SPA (never
          // server-rendered) and `window`/`document` are used
          // unconditionally elsewhere in this same callback anyway, so the
          // false branch can't be meaningfully exercised in a browser test.
          /* v8 ignore next */
          if (typeof window !== "undefined") {
            (window as unknown as { posthog: typeof posthog }).posthog =
              posthog;
          }
          if (publicEnv.data?.NODE_ENV === "development") posthog.debug();
          cancelStartSessionRecordingRef.current =
            startSessionRecordingWhenIdle();
        },
      });
    }

    return () => {
      cancelStartSessionRecordingRef.current?.();
      cancelStartSessionRecordingRef.current = null;
    };
  }, [publicEnv.data]);

  return publicEnv.data?.POSTHOG_KEY ? posthog : undefined;
}
