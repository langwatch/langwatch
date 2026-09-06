import { useEffect, useState } from "react";
import { pollForGlobal } from "~/utils/pollForGlobal";

// gtag is defined by GTM's container once it loads — which is now
// idle-deferred — so it may not exist yet on the render that first builds
// the analytics client. Poll for it and flip once it's ready so callers can
// re-render and register providers that depend on it, instead of the
// google analytics provider being silently skipped forever.
export function useIsGtagReady(): boolean {
  const [isGtagReady, setIsGtagReady] = useState(
    () => typeof window !== "undefined" && Boolean((window as any).gtag),
  );

  useEffect(() => {
    if (isGtagReady) return;
    return pollForGlobal(
      () => (window as any).gtag,
      () => setIsGtagReady(true),
    );
  }, [isGtagReady]);

  return isGtagReady;
}
