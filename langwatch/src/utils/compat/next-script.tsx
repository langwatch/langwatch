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

function runWhenIdle(callback: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 4000 });
    return;
  }
  // Safari has no requestIdleCallback — fall back to load + timeout.
  if (document.readyState === "complete") {
    setTimeout(callback, 0);
  } else {
    window.addEventListener("load", () => setTimeout(callback, 0), {
      once: true,
    });
  }
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
    } else {
      runWhenIdle(inject);
    }

    return () => {
      // Don't remove on unmount — 3rd party scripts should persist
    };
  }, []);

  return null; // Scripts are injected into <head>, not rendered inline
}
