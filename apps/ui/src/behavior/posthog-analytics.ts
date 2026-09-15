import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import type { PublicEnvironment } from "../model/public-environment";

/**
 * The public configuration PostHog needs — the composing application
 * resolves and passes it; this behaviour never reads the environment itself.
 */
export type PostHogPublicConfig = Pick<
  PublicEnvironment,
  "POSTHOG_KEY" | "POSTHOG_HOST" | "NODE_ENV"
>;

// Returns a cancel function so a torn-down (or re-run) effect can drop
// pending work — otherwise a stale callback could start recording after
// the component believes it never started, re-enabling it from under later state.
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

export function usePostHog(config: PostHogPublicConfig | undefined) {
  const cancelStartSessionRecordingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!config) return;

    const posthogKey = config.POSTHOG_KEY;
    const posthogHost = config.POSTHOG_HOST;

    if (posthogKey) {
      // capture_pageview: "history_change" captures $pageview on every
      // History API navigation, not just initial load (posthog-js 1.369
      // otherwise defaults to initial-load-only). We do NOT also call
      // capture("$pageview") on route change ourselves — that caused a
      // multiplier bug under the old next-router compat layer.
      posthog.init(posthogKey, {
        api_host: posthogHost ?? "https://eu.i.posthog.com",
        person_profiles: "always",
        autocapture: true,
        capture_pageview: "history_change",
        capture_exceptions: true,
        // Recording stays configured but starts disabled — the recorder
        // chunk (rrweb + replay, 50KB+) was loading eagerly as part of
        // init, competing with first paint. Its fetch alone is deferred
        // to idle via startSessionRecordingWhenIdle(); core capture stays eager.
        session_recording: {
          recordCrossOriginIframes: true,
        },
        disable_session_recording: true,
        loaded: (posthog) => {
          // Explicitly exposes `window.posthog` so the PostHog toolbar can
          // attach in any environment — bundlers can strip the implicit
          // global posthog-js sets itself. SSR-unreachable in this Vite SPA.
          /* v8 ignore next */
          if (typeof window !== "undefined") {
            (window as unknown as { posthog: typeof posthog }).posthog = posthog;
          }
          if (config.NODE_ENV === "development") posthog.debug();
          cancelStartSessionRecordingRef.current = startSessionRecordingWhenIdle();
        },
      });
    }

    return () => {
      cancelStartSessionRecordingRef.current?.();
      cancelStartSessionRecordingRef.current = null;
    };
  }, [config]);

  return config?.POSTHOG_KEY ? posthog : undefined;
}
