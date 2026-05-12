import { useEffect } from "react";
import {
  URL_PARAM_TO_FIELD,
  setAttributionIfAbsent,
  type AttributionField,
} from "~/utils/attribution";

/**
 * Strips query and fragment from a referrer URL so we never forward
 * sensitive query params or hash data to Customer.io.
 * Returns null when the referrer isn't a parseable URL.
 */
function sanitizeReferrer(referrer: string): string | null {
  try {
    const url = new URL(referrer);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Captures first-touch attribution on mount.
 *
 * Writes `?ref=` + utm_* URL params and `document.referrer` into
 * sessionStorage via `setAttributionIfAbsent`. Mount once at the app root
 * (see `OuterProviders`) so it fires for every landing URL — including
 * unauthenticated public pages — before any navigation can drop the query
 * string.
 *
 * All storage access + schema lives in `~/utils/attribution`; this hook is the
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

    const referrer = document.referrer
      ? sanitizeReferrer(document.referrer)
      : null;
    if (referrer) {
      setAttributionIfAbsent("referrer", referrer);
    }
  }, []);
}
