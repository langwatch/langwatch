import { useState, useEffect } from "react";

/**
 * Hook to track page visibility state
 * Returns true when the page is visible, false when hidden
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    // SSR-safe initial state
    if (typeof document === "undefined") return true;
    return !document.hidden;
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
