import { useEffect } from "react";
import {
  URL_PARAM_TO_FIELD,
  setAttributionIfAbsent,
  type AttributionField,
} from "./attribution";

/**
 * Captures first-touch attribution on mount.
 *
 * Writes `?ref=` + utm_* URL params and `document.referrer` into
 * sessionStorage via `setAttributionIfAbsent`. Mount once at the app root
 * (see `OuterProviders`) so it fires for every landing URL — including
 * unauthenticated public pages — before any navigation can drop the query
 * string.
 *
 * All storage access + schema lives in `./attribution`; this hook is the
 * React-side write trigger only.
 */
export function useAttributionCapture(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    for (const [urlParam, field] of Object.entries(URL_PARAM_TO_FIELD) as [
      string,
      AttributionField,
    ][]) {
      const value = params.get(urlParam);
      if (value) setAttributionIfAbsent(field, value);
    }

    if (document.referrer) {
      setAttributionIfAbsent("referrer", document.referrer);
    }
  }, []);
}
