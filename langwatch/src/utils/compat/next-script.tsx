/**
 * Replacement for next/script — renders inline <script> tags.
 * Next.js Script component managed loading strategy (afterInteractive, etc.).
 * In our SPA, all scripts load after the app hydrates, so we just render them.
 */
import { useEffect, useRef, type ReactNode } from "react";

interface ScriptProps {
  id?: string;
  src?: string;
  strategy?: "afterInteractive" | "lazyOnload" | "beforeInteractive" | "worker";
  children?: ReactNode;
  onLoad?: () => void;
  onError?: () => void;
  [key: string]: any;
}

export default function Script({
  id,
  src,
  strategy: _strategy,
  children,
  onLoad,
  onError,
  ...rest
}: ScriptProps) {
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    const script = document.createElement("script");
    if (id) script.id = id;

    if (src) {
      script.src = src;
      script.async = true;
      if (onLoad) script.onload = onLoad;
      if (onError) script.onerror = onError;
    } else if (children) {
      // Inline script content
      const content = typeof children === "string" ? children : "";
      script.textContent = content;
    }

    for (const [key, value] of Object.entries(rest)) {
      if (key !== "dangerouslySetInnerHTML") {
        script.setAttribute(key, String(value));
      }
    }

    document.head.appendChild(script);

    return () => {
      // Don't remove on unmount — 3rd party scripts should persist
    };
  }, []);

  return null; // Scripts are injected into <head>, not rendered inline
}
