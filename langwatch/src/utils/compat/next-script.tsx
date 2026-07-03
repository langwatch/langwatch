/**
 * Replacement for next/script — renders inline <script> tags.
 * Next.js Script component managed loading strategy (afterInteractive, etc.).
 * In our SPA, all scripts load after the app hydrates. `beforeInteractive`
 * scripts inject immediately; everything else (`afterInteractive`,
 * `lazyOnload`, or unset) is deferred to idle time so third-party tags don't
 * compete with the initial route's JS for main-thread time.
 */
import { type ReactNode, useEffect, useRef } from "react";

interface ScriptProps {
  id?: string;
  src?: string;
  strategy?: "afterInteractive" | "lazyOnload" | "beforeInteractive" | "worker";
  children?: ReactNode;
  onLoad?: () => void;
  onError?: () => void;
  [key: string]: any;
}

// Returns a cancel function so callers can drop pending work if the
// component unmounts before the callback fires — otherwise a script whose
// content closes over per-user/org state (e.g. Pendo's identify payload)
// could inject stale data after the user who requested it has navigated
// away or logged out.
function runWhenIdle(callback: () => void): () => void {
  let cancelled = false;
  const guarded = () => {
    if (!cancelled) callback();
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

export default function Script({
  id,
  src,
  strategy,
  children,
  onLoad,
  onError,
  ...rest
}: ScriptProps) {
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    const inject = () => {
      const script = document.createElement("script");
      if (id) script.id = id;

      if (src) {
        script.src = src;
        script.async = true;
        if (onLoad) script.onload = onLoad;
        if (onError) script.onerror = onError;
      } else if (typeof children === "string") {
        script.textContent = children;
      }

      for (const [key, value] of Object.entries(rest)) {
        if (key !== "dangerouslySetInnerHTML") {
          script.setAttribute(key, String(value));
        }
      }

      document.head.appendChild(script);
    };

    if (strategy === "beforeInteractive") {
      inject();
      return;
    }

    const cancel = runWhenIdle(inject);
    return cancel;
  }, []);

  return null; // Scripts are injected into <head>, not rendered inline
}
